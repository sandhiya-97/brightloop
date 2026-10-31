const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { pagination, makeNumber } = require('../utils/helpers');
const router = express.Router();

router.get('/templates', requireAuth, requireRole('admin','staff'), asyncHandler(async (req,res) => {
  const {page,limit,offset}=pagination(req.query);
  const [result,count]=await Promise.all([
    db.query(`SELECT t.*,COALESCE((SELECT json_agg(json_build_object('id',l.id,'productId',l.product_id,'variantId',l.variant_id,'quantity',l.quantity,'unitPrice',l.unit_price::text) ORDER BY l.id) FROM quotation_template_lines l WHERE l.template_id=t.id),'[]'::json) AS lines FROM quotation_templates t ORDER BY t.name LIMIT $1 OFFSET $2`,[limit,offset]),
    db.query('SELECT COUNT(*)::int AS total FROM quotation_templates'),
  ]);
  res.json({ data: result.rows, pagination:{page,limit,total:count.rows[0].total} });
}));
router.post('/templates', requireAuth, requireRole('admin'), validate(z.object({
  name:z.string().trim().min(2).max(120), validityDays:z.coerce.number().int().min(1).max(365),
  planId:z.coerce.number().int().positive().nullable().optional(),
  lines:z.array(z.object({ productId:z.coerce.number().int().positive(), variantId:z.coerce.number().int().positive().nullable().optional(), quantity:z.coerce.number().int().positive(), unitPrice:z.coerce.number().min(0) })).min(1),
})), asyncHandler(async(req,res) => {
  const b=req.body;
  const row=await db.transaction(async(client)=>{
    const inserted=await client.query('INSERT INTO quotation_templates(name,validity_days,plan_id,created_by) VALUES($1,$2,$3,$4) RETURNING *',[b.name,b.validityDays,b.planId||null,req.user.id]);
    for(const line of b.lines){
      const product=await client.query(`SELECT p.id FROM products p WHERE p.id=$1 AND p.is_active=TRUE AND ($2::bigint IS NULL OR EXISTS(SELECT 1 FROM product_variants v WHERE v.id=$2 AND v.product_id=p.id AND v.is_active=TRUE))`,[line.productId,line.variantId||null]);
      if(!product.rowCount)throw new AppError(400,'INVALID_PRODUCT','A template product or variant is not active or does not belong to that product');
      await client.query('INSERT INTO quotation_template_lines(template_id,product_id,variant_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5)',[inserted.rows[0].id,line.productId,line.variantId||null,line.quantity,line.unitPrice]);
    }
    return inserted.rows[0];
  });
  res.status(201).json({data:row});
}));

router.get('/', requireAuth, asyncHandler(async(req,res) => {
  await db.query("UPDATE quotations SET status='expired' WHERE status='quotation' AND valid_until<CURRENT_DATE");
  const {page,limit,offset}=pagination(req.query);const own=req.user.role==='customer';
  const values=own?[req.user.id,limit,offset]:[limit,offset];const where=own?'WHERE q.customer_id=$1':'';const l=own?'$2':'$1';const o=own?'$3':'$2';
  const [rows,count]=await Promise.all([
    db.query(`SELECT q.*,u.full_name AS customer_name,q.plan_name_snapshot AS plan_name,q.plan_price_snapshot::text AS plan_price,q.billing_period_snapshot AS billing_period,(SELECT s.id FROM subscriptions s WHERE s.quotation_id=q.id) AS subscription_id FROM quotations q JOIN users u ON u.id=q.customer_id ${where} ORDER BY q.created_at DESC LIMIT ${l} OFFSET ${o}`,values),
    db.query(`SELECT COUNT(*)::int AS total FROM quotations q ${where}`,own?[req.user.id]:[]),
  ]);
  res.json({data:rows.rows,pagination:{page,limit,total:count.rows[0].total}});
}));

const quoteSchema=z.object({
  customerId:z.coerce.number().int().positive(), planId:z.coerce.number().int().positive().optional(),
  templateId:z.coerce.number().int().positive().nullable().optional(),
  quantity:z.coerce.number().int().positive().default(1), validityDays:z.coerce.number().int().min(1).max(365).optional(),
  paymentTermsDays:z.coerce.number().int().min(0).max(365).default(0),
  lines:z.array(z.object({productId:z.coerce.number().int().positive(),variantId:z.coerce.number().int().positive().nullable().optional(),description:z.string().trim().min(1).max(250),quantity:z.coerce.number().int().positive(),unitPrice:z.coerce.number().min(0).multipleOf(0.01)})).default([]),
});
router.post('/', requireAuth, requireRole('admin','staff'), validate(quoteSchema), asyncHandler(async(req,res) => {
  const b=req.body;
  let template=null; let lines=b.lines;
  if(b.templateId){
    const tr=await db.query('SELECT * FROM quotation_templates WHERE id=$1',[b.templateId]);
    if(!tr.rowCount)throw new AppError(404,'NOT_FOUND','Quotation template not found');
    template=tr.rows[0];
    const presets=await db.query(`SELECT l.*,p.name,COALESCE(t.rate_percent,0)::text AS tax_percent,v.value AS variant_value FROM quotation_template_lines l JOIN products p ON p.id=l.product_id LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id AND t.is_active=TRUE LEFT JOIN product_variants v ON v.id=l.variant_id WHERE l.template_id=$1 ORDER BY l.id`,[template.id]);
    lines=presets.rows.map(l=>({productId:l.product_id,variantId:l.variant_id,description:`${l.name}${l.variant_value?` — ${l.variant_value}`:''}`,quantity:l.quantity,unitPrice:Number(l.unit_price),taxPercent:Number(l.tax_percent)}));
  } else {
    lines=await Promise.all(lines.map(async(line)=>{
      const product=await db.query(`SELECT p.name,COALESCE(t.rate_percent,0)::text AS tax_percent,v.value AS variant_value FROM products p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id AND t.is_active=TRUE LEFT JOIN product_variants v ON v.id=$2 AND v.product_id=p.id AND v.is_active=TRUE WHERE p.id=$1 AND p.is_active=TRUE AND ($2::bigint IS NULL OR v.id IS NOT NULL)`,[line.productId,line.variantId||null]);
      if(!product.rowCount)throw new AppError(400,'INVALID_PRODUCT','A selected product or variant is not active');
      return {...line,description:`${product.rows[0].name}${product.rows[0].variant_value?` — ${product.rows[0].variant_value}`:''}`,taxPercent:Number(product.rows[0].tax_percent)};
    }));
  }
  if(!lines.length)throw new AppError(400,'VALIDATION_ERROR','Add at least one quotation line','lines');
  const planId=b.planId||template?.plan_id;
  if(!planId)throw new AppError(400,'VALIDATION_ERROR','Select a plan','planId');
  const [customer,plan]=await Promise.all([
    db.query("SELECT id FROM users WHERE id=$1 AND role='customer' AND is_active=TRUE",[b.customerId]),
    db.query(`SELECT p.*,COALESCE(t.rate_percent,0)::text AS tax_percent FROM plans p LEFT JOIN tax_rates t ON t.id=p.default_tax_rate_id AND t.is_active=TRUE WHERE p.id=$1 AND p.is_active=TRUE AND (p.available_from IS NULL OR p.available_from<=CURRENT_DATE) AND (p.available_until IS NULL OR p.available_until>=CURRENT_DATE)`,[planId]),
  ]);
  if(!customer.rowCount)throw new AppError(404,'NOT_FOUND','Customer not found');
  if(!plan.rowCount)throw new AppError(404,'NOT_FOUND','Plan not found');
  if(b.quantity<Number(plan.rows[0].minimum_quantity))throw new AppError(400,'QUANTITY_BELOW_MINIMUM',`Minimum quantity for this plan is ${plan.rows[0].minimum_quantity}`,'quantity');
  const validityDays=b.validityDays||template?.validity_days||30;
  const validUntil=new Date();validUntil.setUTCDate(validUntil.getUTCDate()+validityDays);
  const quote=await db.transaction(async(client)=>{
    const selectedPlan=plan.rows[0];
    const inserted=await client.query(`INSERT INTO quotations(quotation_number,customer_id,template_id,plan_id,plan_name_snapshot,plan_price_snapshot,billing_period_snapshot,plan_tax_percent_snapshot,quantity,valid_until,payment_terms_days,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[makeNumber('QUO'),b.customerId,template?.id||null,planId,selectedPlan.name,selectedPlan.price,selectedPlan.billing_period,selectedPlan.tax_percent,b.quantity,validUntil.toISOString().slice(0,10),b.paymentTermsDays,req.user.id]);
    for(const line of lines)await client.query(`INSERT INTO quotation_lines(quotation_id,product_id,variant_id,description,quantity,unit_price,tax_percent_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,[inserted.rows[0].id,line.productId,line.variantId||null,line.description,line.quantity,line.unitPrice,line.taxPercent]);
    return inserted.rows[0];
  });
  res.status(201).json({data:quote});
}));

router.post('/:id/accept', requireAuth, asyncHandler(async(req,res) => {
  const existing=await db.query('SELECT id,customer_id,status,valid_until FROM quotations WHERE id=$1',[req.params.id]);
  if(!existing.rowCount)throw new AppError(404,'NOT_FOUND','Quotation not found');
  const quote=existing.rows[0];
  if(req.user.role==='customer'&&String(quote.customer_id)!==String(req.user.id))throw new AppError(404,'NOT_FOUND','Quotation not found');
  const result=await db.query("UPDATE quotations SET status='accepted' WHERE id=$1 AND status='quotation' AND valid_until>=CURRENT_DATE RETURNING id",[quote.id]);
  if(!result.rowCount)throw new AppError(409,'QUOTATION_EXPIRED','Quotation is expired or no longer open');
  res.json({data:{accepted:true,quotationId:quote.id}});
}));
module.exports=router;
