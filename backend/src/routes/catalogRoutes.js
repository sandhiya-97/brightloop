const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { pagination } = require('../utils/helpers');
const router = express.Router();
const staffRead = [requireAuth, requireRole('admin','staff')];
const adminWrite = [requireAuth, requireRole('admin')];
const money = z.coerce.number().min(0).max(9999999999.99).multipleOf(0.01);

// Products
router.get('/products', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
  const where = includeInactive ? '' : 'WHERE p.is_active=TRUE';
  const costField = req.user.role === 'admin' ? 'p.cost_price::text,' : '';
  const [rows, total] = await Promise.all([
    db.query(`SELECT p.id,p.name,p.product_type,p.sales_price::text,${costField}p.notes,p.default_tax_rate_id,p.is_active,p.created_at,
      COALESCE((SELECT json_agg(json_build_object('id',v.id,'name',v.name,'value',v.value,'priceDelta',v.price_delta::text,'sku',v.sku) ORDER BY v.id) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=TRUE),'[]'::json) AS variants
      FROM products p ${where} ORDER BY p.name LIMIT $1 OFFSET $2`, [limit, offset]),
    db.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`),
  ]);
  res.json({ data: rows.rows, pagination: { page, limit, total: total.rows[0].total } });
}));
const productSchema = z.object({ name:z.string().trim().min(2).max(120), productType:z.enum(['service','goods','software']), salesPrice:money, costPrice:money.default(0), notes:z.string().max(2000).nullable().optional(), defaultTaxRateId:z.coerce.number().int().positive().nullable().optional() });
router.post('/products', ...adminWrite, validate(productSchema), asyncHandler(async (req,res) => {
  const b=req.body; const result=await db.query(`INSERT INTO products(name,product_type,sales_price,cost_price,notes,default_tax_rate_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.name,b.productType,b.salesPrice,b.costPrice,b.notes||null,b.defaultTaxRateId||null]);
  res.status(201).json({data:result.rows[0]});
}));
router.put('/products/:id', ...adminWrite, validate(productSchema), asyncHandler(async(req,res)=>{
  const b=req.body; const r=await db.query(`UPDATE products SET name=$1,product_type=$2,sales_price=$3,cost_price=$4,notes=$5,default_tax_rate_id=$6,updated_at=NOW() WHERE id=$7 RETURNING *`,[b.name,b.productType,b.salesPrice,b.costPrice,b.notes||null,b.defaultTaxRateId||null,req.params.id]);
  if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Product not found'); res.json({data:r.rows[0]});
}));
router.delete('/products/:id', ...adminWrite, asyncHandler(async(req,res)=>{const r=await db.query('UPDATE products SET is_active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Product not found');res.json({data:{archived:true}});}));
router.post('/products/:id/variants', ...adminWrite, validate(z.object({name:z.string().trim().min(1).max(80),value:z.string().trim().min(1).max(100),priceDelta:z.coerce.number().min(-999999).max(999999).multipleOf(0.01),sku:z.string().trim().max(80).nullable().optional()})), asyncHandler(async(req,res)=>{
  const {name,value,priceDelta,sku}=req.body; const r=await db.query(`INSERT INTO product_variants(product_id,name,value,price_delta,sku) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.params.id,name,value,priceDelta,sku||null]);res.status(201).json({data:r.rows[0]});
}));

// Tax rules
router.get('/taxes', ...staffRead, asyncHandler(async(req,res)=>{const {page,limit,offset}=pagination(req.query);const [r,count]=await Promise.all([db.query('SELECT id,name,rate_percent::text,is_active FROM tax_rates WHERE is_active=TRUE ORDER BY name LIMIT $1 OFFSET $2',[limit,offset]),db.query('SELECT COUNT(*)::int AS total FROM tax_rates WHERE is_active=TRUE')]);res.json({data:r.rows,pagination:{page,limit,total:count.rows[0].total}});}));
router.post('/taxes', ...adminWrite, validate(z.object({name:z.string().trim().min(2).max(80),ratePercent:z.coerce.number().min(0).max(100).multipleOf(0.0001)})), asyncHandler(async(req,res)=>{const {name,ratePercent}=req.body;const r=await db.query('INSERT INTO tax_rates(name,rate_percent) VALUES($1,$2) RETURNING *',[name,ratePercent]);res.status(201).json({data:r.rows[0]});}));
router.put('/taxes/:id', ...adminWrite, validate(z.object({name:z.string().trim().min(2).max(80),ratePercent:z.coerce.number().min(0).max(100).multipleOf(0.0001),isActive:z.boolean().default(true)})), asyncHandler(async(req,res)=>{const b=req.body;const r=await db.query('UPDATE tax_rates SET name=$1,rate_percent=$2,is_active=$3 WHERE id=$4 RETURNING *',[b.name,b.ratePercent,b.isActive,req.params.id]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Tax rule not found');res.json({data:r.rows[0]});}));

// Plans
router.get('/plans', requireAuth, asyncHandler(async(req,res)=>{const {page,limit,offset}=pagination(req.query);const includeInactive=req.user.role==='admin'&&req.query.includeInactive==='true';const w=includeInactive?'':req.user.role==='customer'?"WHERE is_active=TRUE AND (available_from IS NULL OR available_from<=CURRENT_DATE) AND (available_until IS NULL OR available_until>=CURRENT_DATE)":'WHERE is_active=TRUE';const [rows,count]=await Promise.all([db.query(`SELECT * FROM plans ${w} ORDER BY name LIMIT $1 OFFSET $2`,[limit,offset]),db.query(`SELECT COUNT(*)::int AS total FROM plans ${w}`)]);res.json({data:rows.rows,pagination:{page,limit,total:count.rows[0].total}});}));
const planSchema=z.object({name:z.string().trim().min(2).max(120),price:money,billingPeriod:z.enum(['daily','weekly','monthly','yearly']),minimumQuantity:z.coerce.number().int().min(1).max(100000),defaultTaxRateId:z.coerce.number().int().positive().nullable().optional(),availableFrom:z.string().date().nullable().optional(),availableUntil:z.string().date().nullable().optional(),autoClose:z.boolean().default(false),closableEarly:z.boolean().default(true),pausable:z.boolean().default(false),renewable:z.boolean().default(true)});
router.post('/plans', ...adminWrite, validate(planSchema), asyncHandler(async(req,res)=>{const b=req.body;const r=await db.query(`INSERT INTO plans(name,price,billing_period,minimum_quantity,default_tax_rate_id,available_from,available_until,auto_close,closable_early,pausable,renewable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[b.name,b.price,b.billingPeriod,b.minimumQuantity,b.defaultTaxRateId||null,b.availableFrom||null,b.availableUntil||null,b.autoClose,b.closableEarly,b.pausable,b.renewable]);res.status(201).json({data:r.rows[0]});}));
router.put('/plans/:id', ...adminWrite, validate(planSchema), asyncHandler(async(req,res)=>{const b=req.body;const r=await db.query(`UPDATE plans SET name=$1,price=$2,billing_period=$3,minimum_quantity=$4,default_tax_rate_id=$5,available_from=$6,available_until=$7,auto_close=$8,closable_early=$9,pausable=$10,renewable=$11,updated_at=NOW() WHERE id=$12 RETURNING *`,[b.name,b.price,b.billingPeriod,b.minimumQuantity,b.defaultTaxRateId||null,b.availableFrom||null,b.availableUntil||null,b.autoClose,b.closableEarly,b.pausable,b.renewable,req.params.id]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Plan not found');res.json({data:r.rows[0]});}));
router.delete('/plans/:id', ...adminWrite, asyncHandler(async(req,res)=>{const r=await db.query('UPDATE plans SET is_active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Plan not found');res.json({data:{archived:true}});}));

// Discounts
router.get('/discounts', ...staffRead, asyncHandler(async(req,res)=>{if(req.user.role!=='admin')return res.json({data:[],pagination:{page:1,limit:25,total:0}});const {page,limit,offset}=pagination(req.query);const [r,count]=await Promise.all([db.query(`SELECT d.*,COALESCE(array_agg(dp.product_id) FILTER(WHERE dp.product_id IS NOT NULL),'{}') AS product_ids FROM discounts d LEFT JOIN discount_products dp ON dp.discount_id=d.id GROUP BY d.id ORDER BY d.created_at DESC LIMIT $1 OFFSET $2`,[limit,offset]),db.query('SELECT COUNT(*)::int AS total FROM discounts')]);res.json({data:r.rows,pagination:{page,limit,total:count.rows[0].total}});}));
const discountSchema=z.object({name:z.string().trim().min(2).max(120),discountType:z.enum(['fixed','percentage']),amount:z.coerce.number().positive().max(9999999999).multipleOf(0.01),minimumPurchase:z.coerce.number().min(0).multipleOf(0.01).default(0),minimumQuantity:z.coerce.number().int().min(1).default(1),startsAt:z.string().datetime().nullable().optional(),endsAt:z.string().datetime().nullable().optional(),usageLimit:z.coerce.number().int().positive().nullable().optional(),appliesTo:z.enum(['products','subscription']),productIds:z.array(z.coerce.number().int().positive()).default([])}).superRefine((value,ctx)=>{if(value.discountType==='percentage'&&value.amount>100)ctx.addIssue({code:'custom',message:'Percentage cannot exceed 100',path:['amount']});if(value.startsAt&&value.endsAt&&value.endsAt<value.startsAt)ctx.addIssue({code:'custom',message:'End date must be after start date',path:['endsAt']});});
router.post('/discounts', ...adminWrite, validate(discountSchema), asyncHandler(async(req,res)=>{const b=req.body;if(b.appliesTo==='products'&&!b.productIds.length)throw new AppError(400,'VALIDATION_ERROR','Choose at least one product','productIds');const d=await db.transaction(async(c)=>{const r=await c.query(`INSERT INTO discounts(name,discount_type,amount,minimum_purchase,minimum_quantity,starts_at,ends_at,usage_limit,applies_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[b.name,b.discountType,b.amount,b.minimumPurchase,b.minimumQuantity,b.startsAt||null,b.endsAt||null,b.usageLimit||null,b.appliesTo]);for(const id of b.productIds)await c.query('INSERT INTO discount_products(discount_id,product_id) VALUES($1,$2)',[r.rows[0].id,id]);return r.rows[0];});res.status(201).json({data:d});}));
router.delete('/discounts/:id', ...adminWrite, asyncHandler(async(req,res)=>{const r=await db.query('UPDATE discounts SET is_active=FALSE WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)throw new AppError(404,'NOT_FOUND','Discount not found');res.json({data:{archived:true}});}));

module.exports=router;
