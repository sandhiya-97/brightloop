const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { pagination, assertOwnerOrStaff, makeNumber } = require('../utils/helpers');
const router = express.Router();

const lineSchema=z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().int().positive().nullable().optional(),quantity:z.coerce.number().int().positive().max(100000)});
async function ownedSubscription(id,user,client=db,lock=false){
 const result=await client.query(`SELECT * FROM subscriptions WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id]);
 if(!result.rowCount)throw new AppError(404,'NOT_FOUND','Subscription not found');
 assertOwnerOrStaff(user,result.rows[0].customer_id);return result.rows[0];
}
async function priceProduct(client,line){
 const result=await client.query(`SELECT p.id,p.name,p.sales_price::text,p.default_tax_rate_id,
   COALESCE(t.rate_percent,0)::text AS tax_percent,v.id AS variant_id,v.value AS variant_value,v.price_delta::text
   FROM products p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id AND t.is_active=TRUE
   LEFT JOIN product_variants v ON v.id=$2 AND v.product_id=p.id AND v.is_active=TRUE
   WHERE p.id=$1 AND p.is_active=TRUE`,[line.productId,line.variantId||null]);
 if(!result.rowCount)throw new AppError(400,'INVALID_PRODUCT','A selected product is not available','productId');
 const product=result.rows[0];
 if(line.variantId&&!product.variant_id)throw new AppError(400,'INVALID_VARIANT','Selected variant is not available','variantId');
 return {...product,description:`${product.name}${product.variant_value?` — ${product.variant_value}`:''}`,unitPrice:Number(product.sales_price)+Number(product.price_delta||0)};
}

router.get('/',requireAuth,asyncHandler(async(req,res)=>{
 const {page,limit,offset}=pagination(req.query);const customer=req.user.role==='customer';
 const values=customer?[req.user.id,limit,offset]:[limit,offset];const where=customer?'WHERE s.customer_id=$1':'';const lim=customer?'$2':'$1';const off=customer?'$3':'$2';
 const [rows,count]=await Promise.all([
  db.query(`SELECT s.id,s.subscription_number,s.customer_id,s.plan_id,s.status,s.start_date,s.expiry_date,s.next_billing_date,s.quantity,s.pausable,s.renewable,s.created_at,u.full_name AS customer_name,s.plan_name_snapshot AS plan_name,s.plan_price_snapshot::text AS plan_price,s.billing_period_snapshot AS billing_period,(SELECT COUNT(*)::int FROM invoices i WHERE i.subscription_id=s.id) AS invoice_count FROM subscriptions s JOIN users u ON u.id=s.customer_id ${where} ORDER BY s.created_at DESC LIMIT ${lim} OFFSET ${off}`,values),
  db.query(`SELECT COUNT(*)::int AS total FROM subscriptions s ${where}`,customer?[req.user.id]:[]),
 ]);
 res.json({data:rows.rows,pagination:{page,limit,total:count.rows[0].total}});
}));
router.get('/:id',requireAuth,asyncHandler(async(req,res)=>{
 const r=await db.query(`SELECT s.*,u.full_name AS customer_name,u.email AS customer_email,s.plan_name_snapshot AS plan_name,s.plan_price_snapshot::text AS plan_price,s.billing_period_snapshot AS billing_period FROM subscriptions s JOIN users u ON u.id=s.customer_id WHERE s.id=$1`,[req.params.id]);
 if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Subscription not found');assertOwnerOrStaff(req.user,r.rows[0].customer_id);
 const lines=await db.query(`SELECT sl.*,p.name AS product_name,v.value AS variant_value FROM subscription_lines sl JOIN products p ON p.id=sl.product_id LEFT JOIN product_variants v ON v.id=sl.variant_id WHERE sl.subscription_id=$1 ORDER BY sl.id`,[req.params.id]);
 res.json({data:{...r.rows[0],lines:lines.rows}});
}));

router.post('/',requireAuth,validate(z.object({customerId:z.coerce.number().int().positive().optional(),planId:z.coerce.number().int().positive(),quantity:z.coerce.number().int().positive().default(1),startDate:z.string().date().optional(),expiryDate:z.string().date().nullable().optional(),paymentTermsDays:z.coerce.number().int().min(0).max(365).default(0),lines:z.array(lineSchema).default([])})),asyncHandler(async(req,res)=>{
 const b=req.body;const customerId=req.user.role==='customer'?req.user.id:b.customerId;
 if(!customerId)throw new AppError(400,'VALIDATION_ERROR','Select a customer','customerId');
 const created=await db.transaction(async(client)=>{
  const customer=await client.query("SELECT id FROM users WHERE id=$1 AND role='customer' AND is_active=TRUE",[customerId]);
  if(!customer.rowCount)throw new AppError(404,'NOT_FOUND','Customer not found');
  const planResult=await client.query(`SELECT p.*,COALESCE(t.rate_percent,0)::text AS tax_percent FROM plans p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id AND t.is_active=TRUE WHERE p.id=$1 AND p.is_active=TRUE`,[b.planId]);
  if(!planResult.rowCount)throw new AppError(404,'NOT_FOUND','Plan not found');
  const plan=planResult.rows[0];const quantity=Number(b.quantity);if(quantity<Number(plan.minimum_quantity))throw new AppError(400,'QUANTITY_BELOW_MINIMUM',`Minimum quantity for this plan is ${plan.minimum_quantity}`,'quantity');
  const today=new Date().toISOString().slice(0,10);const startDate=b.startDate||today;
  if((plan.available_from&&startDate<plan.available_from)||(plan.available_until&&startDate>plan.available_until))throw new AppError(400,'PLAN_UNAVAILABLE','The plan is not available on the selected start date','planId');
  const inserted=await client.query(`INSERT INTO subscriptions(subscription_number,customer_id,plan_id,plan_name_snapshot,plan_price_snapshot,billing_period_snapshot,status,quantity,plan_tax_percent_snapshot,start_date,expiry_date,next_billing_date,payment_terms_days,auto_close,closable_early,pausable,renewable,created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,NULL,$11,$12,$13,$14,$15,$16) RETURNING *`,[makeNumber('SUB'),customerId,plan.id,plan.name,plan.price,plan.billing_period,quantity,plan.tax_percent,startDate,b.expiryDate||null,b.paymentTermsDays,plan.auto_close,plan.closable_early,plan.pausable,plan.renewable,req.user.id]);
  for(const line of b.lines){const product=await priceProduct(client,line);await client.query(`INSERT INTO subscription_lines(subscription_id,product_id,variant_id,description,quantity,unit_price,tax_rate_id,tax_percent_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[inserted.rows[0].id,product.id,product.variant_id,product.description,line.quantity,product.unitPrice,product.default_tax_rate_id,product.tax_percent]);}
  return inserted.rows[0];
 });
 res.status(201).json({data:created});
}));

router.post('/from-quotation/:id',requireAuth,asyncHandler(async(req,res)=>{
 const result=await db.transaction(async(client)=>{
  const qr=await client.query('SELECT * FROM quotations WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!qr.rowCount)throw new AppError(404,'NOT_FOUND','Quotation not found');const quote=qr.rows[0];
  if(req.user.role==='customer'&&String(quote.customer_id)!==String(req.user.id))throw new AppError(404,'NOT_FOUND','Quotation not found');
  const existing=await client.query('SELECT * FROM subscriptions WHERE quotation_id=$1',[quote.id]);if(existing.rowCount)return {row:existing.rows[0],created:false};
  if(quote.status!=='accepted')throw new AppError(409,'INVALID_STATE','Accept the quotation before conversion');
  const planResult=await client.query(`SELECT p.*,COALESCE(t.rate_percent,0)::text AS tax_percent FROM plans p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id WHERE p.id=$1 AND p.is_active=TRUE AND (p.available_from IS NULL OR p.available_from<=CURRENT_DATE) AND (p.available_until IS NULL OR p.available_until>=CURRENT_DATE)`,[quote.plan_id]);
  if(!planResult.rowCount)throw new AppError(409,'PLAN_UNAVAILABLE','The quoted plan is no longer active');const plan=planResult.rows[0];
  if(Number(quote.quantity)<Number(plan.minimum_quantity))throw new AppError(409,'QUANTITY_BELOW_MINIMUM','The quoted quantity is below the plan minimum');
  const today=new Date().toISOString().slice(0,10);
  const sub=await client.query(`INSERT INTO subscriptions(subscription_number,customer_id,plan_id,plan_name_snapshot,plan_price_snapshot,billing_period_snapshot,quotation_id,status,quantity,plan_tax_percent_snapshot,start_date,next_billing_date,payment_terms_days,auto_close,closable_early,pausable,renewable,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[makeNumber('SUB'),quote.customer_id,quote.plan_id,quote.plan_name_snapshot,quote.plan_price_snapshot,quote.billing_period_snapshot,quote.id,quote.quantity,quote.plan_tax_percent_snapshot,today,quote.payment_terms_days,plan.auto_close,plan.closable_early,plan.pausable,plan.renewable,req.user.id]);
  const lines=await client.query('SELECT * FROM quotation_lines WHERE quotation_id=$1 ORDER BY id',[quote.id]);
  for(const line of lines.rows)await client.query(`INSERT INTO subscription_lines(subscription_id,product_id,variant_id,description,quantity,unit_price,tax_percent_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,[sub.rows[0].id,line.product_id,line.variant_id,line.description,line.quantity,line.unit_price,line.tax_percent_snapshot]);
  return {row:sub.rows[0],created:true};
 });
 res.status(result.created?201:200).json({data:result.row,alreadyConverted:!result.created});
}));

router.post('/:id/quotation',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(current.status!=='draft')throw new AppError(409,'INVALID_STATE','Only a draft subscription can move to quotation');const r=await client.query("UPDATE subscriptions SET status='quotation',updated_at=NOW() WHERE id=$1 RETURNING *",[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/confirm',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(current.status!=='draft'&&current.status!=='quotation')throw new AppError(409,'INVALID_STATE','Only a draft or quotation subscription can be confirmed');const r=await client.query("UPDATE subscriptions SET status='confirmed',updated_at=NOW() WHERE id=$1 RETURNING *",[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/activate',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(current.status!=='confirmed')throw new AppError(409,'INVALID_STATE','Only a confirmed subscription can be activated');const r=await client.query("UPDATE subscriptions SET status='active',next_billing_date=COALESCE(next_billing_date,start_date),updated_at=NOW() WHERE id=$1 RETURNING *",[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/pause',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(!current.pausable)throw new AppError(400,'PAUSE_NOT_ALLOWED','This plan does not allow pauses');if(current.status!=='active')throw new AppError(409,'INVALID_STATE','Only an active subscription can be paused');const r=await client.query("UPDATE subscriptions SET status='paused',paused_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/resume',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(current.status!=='paused'||!current.paused_at)throw new AppError(409,'INVALID_STATE','Subscription is not paused');const r=await client.query(`UPDATE subscriptions SET status='active',next_billing_date=CASE WHEN next_billing_date IS NULL THEN CURRENT_DATE ELSE next_billing_date+GREATEST(1,CEIL(EXTRACT(EPOCH FROM(NOW()-paused_at))/86400)::int) END,paused_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/close',requireAuth,asyncHandler(async(req,res)=>{
 const updated=await db.transaction(async(client)=>{const current=await ownedSubscription(req.params.id,req.user,client,true);if(req.user.role==='customer'&&!current.closable_early)throw new AppError(403,'CLOSE_NOT_ALLOWED','This plan does not allow early closure');if(!['draft','quotation','confirmed','active','paused'].includes(current.status))throw new AppError(409,'INVALID_STATE','Subscription cannot be closed from its current state');const r=await client.query("UPDATE subscriptions SET status='closed',closed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[current.id]);return r.rows[0];});
 res.json({data:updated});
}));
router.post('/:id/addons',requireAuth,validate(z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().int().positive().nullable().optional(),quantity:z.coerce.number().int().min(0).max(100000)})),asyncHandler(async(req,res)=>{
 const b=req.body;const result=await db.transaction(async(client)=>{
  const subscription=await ownedSubscription(req.params.id,req.user,client,true);if(!['active','confirmed'].includes(subscription.status))throw new AppError(409,'INVALID_STATE','Add-ons can only be changed on confirmed or active subscriptions');
  const product=await priceProduct(client,b);const existing=await client.query('SELECT id FROM subscription_lines WHERE subscription_id=$1 AND product_id=$2 AND variant_id IS NOT DISTINCT FROM $3',[subscription.id,b.productId,product.variant_id]);
  if(existing.rowCount){if(b.quantity===0)await client.query('DELETE FROM subscription_lines WHERE id=$1',[existing.rows[0].id]);else await client.query('UPDATE subscription_lines SET quantity=$1 WHERE id=$2',[b.quantity,existing.rows[0].id]);}
  else if(b.quantity>0)await client.query(`INSERT INTO subscription_lines(subscription_id,product_id,variant_id,description,quantity,unit_price,tax_rate_id,tax_percent_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[subscription.id,product.id,product.variant_id,product.description,b.quantity,product.unitPrice,product.default_tax_rate_id,product.tax_percent]);
  return {updated:true};
 });res.json({data:result});
}));
module.exports=router;
