const express=require('express');
const {z}=require('zod');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {asyncHandler}=require('../middleware/errors');
const {validate}=require('../middleware/validate');
const router=express.Router();

router.get('/',requireAuth,validate(z.object({from:z.string().date().optional(),to:z.string().date().optional()}),'query'),asyncHandler(async(req,res)=>{
 const {from,to}=req.query;const customer=req.user.role==='customer';
 const invoiceValues=[];const invoiceFilters=[];
 if(customer){invoiceValues.push(req.user.id);invoiceFilters.push(`i.customer_id=$${invoiceValues.length}`);}
 if(from){invoiceValues.push(from);invoiceFilters.push(`i.issue_date >= $${invoiceValues.length}`);}
 if(to){invoiceValues.push(to);invoiceFilters.push(`i.issue_date <= $${invoiceValues.length}`);}
 const invoiceWhere=invoiceFilters.length?`WHERE ${invoiceFilters.join(' AND ')}`:'';
 const payValues=[];const payFilters=[];
 if(customer){payValues.push(req.user.id);payFilters.push(`i.customer_id=$${payValues.length}`);}
 if(from){payValues.push(from);payFilters.push(`p.paid_at::date >= $${payValues.length}`);}
 if(to){payValues.push(to);payFilters.push(`p.paid_at::date <= $${payValues.length}`);}
 const payWhere=payFilters.length?`WHERE ${payFilters.join(' AND ')}`:'';
 const activeSql=customer?`(SELECT COUNT(*)::int FROM subscriptions s WHERE s.customer_id=$1 AND s.status='active')`:`(SELECT COUNT(*)::int FROM subscriptions s WHERE s.status='active')`;
 const [invoiceAgg,paymentAgg,overdue,recent]=await Promise.all([
  db.query(`SELECT ${activeSql} AS active_subscriptions,
    COALESCE(SUM(GREATEST(i.total-COALESCE(paid.paid,0),0)) FILTER(WHERE i.status='confirmed'),0)::numeric(14,2)::text AS amount_owed,
    COUNT(DISTINCT i.id) FILTER(WHERE i.status='confirmed' AND i.due_date<CURRENT_DATE AND COALESCE(paid.paid,0)<i.total)::int AS overdue_count,
    COUNT(DISTINCT i.id)::int AS invoice_count
    FROM invoices i LEFT JOIN LATERAL(SELECT SUM(p.amount) AS paid FROM payments p WHERE p.invoice_id=i.id) paid ON TRUE ${invoiceWhere}`,invoiceValues),
  db.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(p.amount),0)::numeric(14,2)::text AS total FROM payments p JOIN invoices i ON i.id=p.invoice_id ${payWhere}`,payValues),
  db.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(GREATEST(i.total-COALESCE(paid.paid,0),0)),0)::numeric(14,2)::text AS total FROM invoices i LEFT JOIN LATERAL(SELECT SUM(amount) AS paid FROM payments WHERE invoice_id=i.id) paid ON TRUE WHERE i.status='confirmed' AND i.due_date<CURRENT_DATE AND COALESCE(paid.paid,0)<i.total ${customer?'AND i.customer_id=$1':''}`,customer?[req.user.id]:[]),
  db.query(`SELECT i.id,i.invoice_number,i.customer_name,i.total::text,i.status,i.issue_date FROM invoices i ${invoiceWhere} ORDER BY i.created_at DESC LIMIT 6`,invoiceValues),
 ]);
 res.json({data:{...invoiceAgg.rows[0],revenue_received:paymentAgg.rows[0].total,collected_in_period:paymentAgg.rows[0].total,payment_count:paymentAgg.rows[0].count,payment_total:paymentAgg.rows[0].total,overdue_total:overdue.rows[0].total,overdue_invoices:overdue.rows[0].count,recent_invoices:recent.rows}});
}));
module.exports=router;
