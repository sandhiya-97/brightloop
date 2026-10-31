const Decimal = require('decimal.js');
const db = require('../config/db');
const { addPeriod, endOfPeriod, makeNumber } = require('../utils/helpers');
Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

const money = (value) => new Decimal(value || 0).toDecimalPlaces(2);
const d2 = (value) => money(value).toFixed(2);

async function buildInvoice(client, subscription) {
  const customerResult = await client.query('SELECT full_name,email FROM users WHERE id=$1', [subscription.customer_id]);
  const customer = customerResult.rows[0];
  const lineResult = await client.query(`SELECT sl.id AS subscription_line_id,sl.product_id,sl.description,sl.quantity,sl.unit_price::text,
      sl.tax_percent_snapshot::text FROM subscription_lines sl WHERE sl.subscription_id=$1 ORDER BY sl.id`, [subscription.id]);
  const lines = [{
    productId: null, subscriptionLineId: null, description: `${subscription.plan_name} plan`,
    quantity: Number(subscription.quantity), unitPrice: subscription.plan_price,
    taxPercent: subscription.plan_tax_percent_snapshot,
  }, ...lineResult.rows.map((line) => ({
    productId: line.product_id, subscriptionLineId: line.subscription_line_id,
    description: line.description, quantity: Number(line.quantity),
    unitPrice: line.unit_price, taxPercent: line.tax_percent_snapshot,
  }))];
  const grossSubtotal = lines.reduce((sum, line) => sum.plus(money(line.unitPrice).times(line.quantity)), new Decimal(0));
  const discount = await eligibleDiscount(client, lines);
  const allocations = allocateDiscount(lines, discount);
  let subtotal = new Decimal(0); let discountTotal = new Decimal(0); let taxTotal = new Decimal(0); let total = new Decimal(0);
  for (let i=0;i<lines.length;i++) {
    const line=lines[i]; const gross=money(line.unitPrice).times(line.quantity);
    const lineDiscount=allocations[i]; const net=gross.minus(lineDiscount);
    const tax=net.times(new Decimal(line.taxPercent || 0)).div(100).toDecimalPlaces(2);
    const lineTotal=net.plus(tax);
    subtotal=subtotal.plus(gross); discountTotal=discountTotal.plus(lineDiscount); taxTotal=taxTotal.plus(tax); total=total.plus(lineTotal);
    line.gross=gross; line.discount=lineDiscount; line.net=net; line.tax=tax; line.total=lineTotal;
  }
  const dueDate = new Date(`${subscription.next_billing_date}T00:00:00Z`);
  dueDate.setUTCDate(dueDate.getUTCDate()+Number(subscription.payment_terms_days));
  const periodEnd = endOfPeriod(subscription.next_billing_date, addPeriod(subscription.next_billing_date, subscription.billing_period));
  const invoice = await client.query(`INSERT INTO invoices(invoice_number,subscription_id,customer_id,discount_id,customer_name,customer_email,period_start,period_end,issue_date,due_date,status,subtotal,discount_total,tax_total,total)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,'draft',$10,$11,$12,$13) RETURNING id,invoice_number`, [
    makeNumber('INV'), subscription.id, subscription.customer_id, discount?.id || null, customer.full_name, customer.email,
    subscription.next_billing_date, subscription.expiry_date && subscription.expiry_date < periodEnd ? subscription.expiry_date : periodEnd,
    dueDate.toISOString().slice(0,10), d2(subtotal), d2(discountTotal), d2(taxTotal), d2(total),
  ]);
  for (const line of lines) {
    await client.query(`INSERT INTO invoice_lines(invoice_id,product_id,subscription_line_id,description,quantity,unit_price,discount_amount,tax_percent_snapshot,line_subtotal,line_tax,line_total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [invoice.rows[0].id,line.productId,line.subscriptionLineId,line.description,line.quantity,d2(line.unitPrice),d2(line.discount),new Decimal(line.taxPercent||0).toFixed(4),d2(line.gross),d2(line.tax),d2(line.total)]);
  }
  return invoice.rows[0];
}

async function eligibleDiscount(client, lines) {
  const candidates=await client.query(`SELECT id FROM discounts WHERE is_active=TRUE
    AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())
    AND (usage_limit IS NULL OR usage_count<usage_limit) ORDER BY id`);
  for(const candidate of candidates.rows){
    const locked=await client.query(`SELECT * FROM discounts WHERE id=$1 AND is_active=TRUE
      AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())
      AND (usage_limit IS NULL OR usage_count<usage_limit) FOR UPDATE`,[candidate.id]);
    if(!locked.rowCount)continue;
    const d=locked.rows[0];
    let productIds=[];
    if(d.applies_to==='products'){
      const links=await client.query('SELECT product_id FROM discount_products WHERE discount_id=$1',[d.id]);
      productIds=links.rows.map(r=>Number(r.product_id));
    }
    const targeted=lines.filter(l=>d.applies_to==='subscription'||productIds.includes(Number(l.productId)));
    const eligibleTotal=targeted.reduce((sum,l)=>sum.plus(money(l.unitPrice).times(l.quantity)),new Decimal(0));
    const quantity=targeted.reduce((n,l)=>n+Number(l.quantity),0);
    if(eligibleTotal.lessThan(d.minimum_purchase)||quantity<Number(d.minimum_quantity))continue;
    if(eligibleTotal.isZero())continue;
    const raw=d.discount_type==='percentage'?eligibleTotal.times(d.amount).div(100):new Decimal(d.amount);
    const amount=Decimal.min(raw,eligibleTotal).toDecimalPlaces(2);
    if(amount.isZero())continue;
    await client.query('UPDATE discounts SET usage_count=usage_count+1 WHERE id=$1',[d.id]);
    return { id: Number(d.id), amount, eligibleIndexes:lines.map((l,i)=>d.applies_to==='subscription'||productIds.includes(Number(l.productId))?i:-1).filter(i=>i>=0) };
  }
  return null;
}

function allocateDiscount(lines, discount) {
  const allocations=lines.map(()=>new Decimal(0));
  if(!discount)return allocations;
  const eligible=discount.eligibleIndexes;
  let remaining=discount.amount;
  for(let pos=0;pos<eligible.length;pos++){
    const i=eligible[pos]; const gross=money(lines[i].unitPrice).times(lines[i].quantity);
    const share=pos===eligible.length-1?remaining:Decimal.min(gross,discount.amount.times(gross).div(eligible.reduce((s,j)=>s.plus(money(lines[j].unitPrice).times(lines[j].quantity)),new Decimal(0))).toDecimalPlaces(2));
    allocations[i]=Decimal.min(gross,share); remaining=remaining.minus(allocations[i]);
  }
  if(!remaining.isZero()){
    for(const i of eligible){const gross=money(lines[i].unitPrice).times(lines[i].quantity);const room=gross.minus(allocations[i]);const add=Decimal.min(room,remaining);allocations[i]=allocations[i].plus(add);remaining=remaining.minus(add);if(remaining.isZero())break;}
  }
  return allocations;
}

async function billOne(subscriptionId, today) {
  return db.transaction(async(client)=>{
    const result=await client.query(`SELECT s.*,s.plan_name_snapshot AS plan_name,s.plan_price_snapshot::text AS plan_price,s.billing_period_snapshot AS billing_period
      FROM subscriptions s WHERE s.id=$1 FOR UPDATE OF s`,[subscriptionId]);
    const s=result.rows[0];
    if(!s||s.status!=='active'||!s.next_billing_date||s.next_billing_date>today)return 0;
    let produced=0; let cycles=0;
    while(s.next_billing_date<=today && cycles<36){
      cycles++;
      if(s.expiry_date && s.next_billing_date>s.expiry_date){
        if(s.auto_close||!s.renewable){await client.query("UPDATE subscriptions SET status='closed',closed_at=NOW(),updated_at=NOW() WHERE id=$1",[s.id]);return produced;}
        const newExpiry=endOfPeriod(s.next_billing_date,addPeriod(s.next_billing_date,s.billing_period));
        s.expiry_date=newExpiry;
        await client.query('UPDATE subscriptions SET expiry_date=$1 WHERE id=$2',[newExpiry,s.id]);
      }
      const already=await client.query('SELECT id FROM invoices WHERE subscription_id=$1 AND period_start=$2',[s.id,s.next_billing_date]);
      if(!already.rowCount){
        await buildInvoice(client,s); produced++;
      }
      const oldDate=s.next_billing_date;
      const next=addPeriod(oldDate,s.billing_period);
      const periodEnd=endOfPeriod(oldDate,next);
      if(s.expiry_date && periodEnd>=s.expiry_date && (s.auto_close||!s.renewable)){
        await client.query("UPDATE subscriptions SET status='closed',closed_at=NOW(),next_billing_date=$1,updated_at=NOW() WHERE id=$2",[next,s.id]);
        return produced;
      }
      if(s.expiry_date && s.renewable && !s.auto_close && periodEnd>=s.expiry_date){
        s.expiry_date=endOfPeriod(next,addPeriod(next,s.billing_period));
        await client.query('UPDATE subscriptions SET expiry_date=$1 WHERE id=$2',[s.expiry_date,s.id]);
      }
      s.next_billing_date=next;
      await client.query('UPDATE subscriptions SET next_billing_date=$1,updated_at=NOW() WHERE id=$2',[next,s.id]);
    }
    return produced;
  });
}

async function runBilling(today = new Date().toISOString().slice(0,10)) {
  await db.query(`UPDATE subscriptions SET status='closed',closed_at=NOW(),updated_at=NOW()
    WHERE status='active' AND expiry_date<$1 AND (auto_close=TRUE OR renewable=FALSE)
    AND (next_billing_date IS NULL OR next_billing_date>expiry_date)`,[today]);
  const due=await db.query(`SELECT id FROM subscriptions WHERE status='active' AND next_billing_date<=$1
    AND (expiry_date IS NULL OR next_billing_date<=expiry_date OR (renewable=TRUE AND auto_close=FALSE))
    ORDER BY next_billing_date LIMIT 200`,[today]);
  let created=0;
  for(const row of due.rows){created+=await billOne(row.id,today);}
  if(created)console.log(`Billing run created ${created} invoice(s) through ${today}`);
  return {scanned:due.rowCount,created};
}
module.exports={runBilling,billOne};
