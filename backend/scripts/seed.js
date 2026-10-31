require('dotenv').config();
const bcrypt=require('bcryptjs');
const {Client}=require('pg');
const {runBilling}=require('../src/services/billingService');

async function user(client,email,name,role,password){const hash=await bcrypt.hash(password,12);const r=await client.query(`INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,is_active=TRUE RETURNING id`,[email.toLowerCase(),hash,name,role]);return r.rows[0].id;}
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required; copy .env.example to .env.');
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 let customerId;
 try{
  await client.query('BEGIN');
  const adminId=await user(client,process.env.SEED_ADMIN_EMAIL||'admin@brightloop.test','Brightloop Admin','admin',process.env.SEED_ADMIN_PASSWORD||'Brightloop!2026');
  await user(client,process.env.SEED_STAFF_EMAIL||'staff@brightloop.test','Morgan Lee','staff',process.env.SEED_STAFF_PASSWORD||'Brightloop!2026');
  customerId=await user(client,process.env.SEED_CUSTOMER_EMAIL||'customer@brightloop.test','Taylor Jordan','customer',process.env.SEED_CUSTOMER_PASSWORD||'Brightloop!2026');
  const tax=await client.query(`INSERT INTO tax_rates(name,rate_percent) VALUES('Standard',18) ON CONFLICT(name) DO UPDATE SET rate_percent=EXCLUDED.rate_percent RETURNING id`);
  const product=await client.query(`INSERT INTO products(name,product_type,sales_price,cost_price,notes,default_tax_rate_id) VALUES('Brightloop Core','software',49,8,'Core software subscription', $1) ON CONFLICT(name) DO UPDATE SET default_tax_rate_id=EXCLUDED.default_tax_rate_id RETURNING id`,[tax.rows[0].id]);
  const addon=await client.query(`INSERT INTO products(name,product_type,sales_price,cost_price,notes,default_tax_rate_id) VALUES('Priority Support','service',19,4,'Priority response and onboarding', $1) ON CONFLICT(name) DO UPDATE SET default_tax_rate_id=EXCLUDED.default_tax_rate_id RETURNING id`,[tax.rows[0].id]);
  await client.query(`INSERT INTO product_variants(product_id,name,value,price_delta,sku) VALUES($1,'Brand','Odoo',560,'BL-ODOO') ON CONFLICT(product_id,name,value) DO UPDATE SET price_delta=EXCLUDED.price_delta`,[product.rows[0].id]);
  const plan=await client.query(`INSERT INTO plans(name,price,billing_period,minimum_quantity,default_tax_rate_id,auto_close,closable_early,pausable,renewable) VALUES('Monthly Starter',49,'monthly',1,$1,FALSE,TRUE,TRUE,TRUE) ON CONFLICT(name) DO UPDATE SET default_tax_rate_id=EXCLUDED.default_tax_rate_id RETURNING id,name,price,billing_period` ,[tax.rows[0].id]);
  await client.query(`INSERT INTO plans(name,price,billing_period,minimum_quantity,default_tax_rate_id,auto_close,closable_early,pausable,renewable) VALUES('Annual Team',490,'yearly',1,$1,FALSE,TRUE,FALSE,TRUE) ON CONFLICT(name) DO NOTHING`,[tax.rows[0].id]);
  const today=new Date().toISOString().slice(0,10);
  const sub=await client.query(`INSERT INTO subscriptions(subscription_number,customer_id,plan_id,plan_name_snapshot,plan_price_snapshot,billing_period_snapshot,status,quantity,plan_tax_percent_snapshot,start_date,next_billing_date,payment_terms_days,auto_close,closable_early,pausable,renewable,created_by) VALUES('SUB-DEMO-001',$1,$2,$3,$4,$5,'active',1,18,$6,$6,15,FALSE,TRUE,TRUE,TRUE,$7) ON CONFLICT(subscription_number) DO UPDATE SET customer_id=EXCLUDED.customer_id,plan_name_snapshot=EXCLUDED.plan_name_snapshot,plan_price_snapshot=EXCLUDED.plan_price_snapshot,billing_period_snapshot=EXCLUDED.billing_period_snapshot RETURNING id`,[customerId,plan.rows[0].id,plan.rows[0].name,plan.rows[0].price,plan.rows[0].billing_period,today,adminId]);
  const line=await client.query('SELECT 1 FROM subscription_lines WHERE subscription_id=$1 AND product_id=$2',[sub.rows[0].id,addon.rows[0].id]);
  if(!line.rowCount)await client.query(`INSERT INTO subscription_lines(subscription_id,product_id,description,quantity,unit_price,tax_rate_id,tax_percent_snapshot) VALUES($1,$2,'Priority Support',1,19,$3,18)`,[sub.rows[0].id,addon.rows[0].id,tax.rows[0].id]);
  await client.query('COMMIT');
  await runBilling();
  console.log('Seeded the Brightloop demo users, tax, product variants, plans, and active subscription.');
  console.log(`Admin: ${process.env.SEED_ADMIN_EMAIL||'admin@brightloop.test'} / ${process.env.SEED_ADMIN_PASSWORD||'Brightloop!2026'}`);
  console.log(`Staff: ${process.env.SEED_STAFF_EMAIL||'staff@brightloop.test'} / ${process.env.SEED_STAFF_PASSWORD||'Brightloop!2026'}`);
  console.log(`Customer: ${process.env.SEED_CUSTOMER_EMAIL||'customer@brightloop.test'} / ${process.env.SEED_CUSTOMER_PASSWORD||'Brightloop!2026'}`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{await client.end();}
}
main().catch(error=>{console.error('Seed failed:',error.message);process.exitCode=1;});
