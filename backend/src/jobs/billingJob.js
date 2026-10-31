const { runBilling } = require('../services/billingService');

function startBillingJob() {
  const run = () => runBilling().catch((error) => console.error('Billing run failed:', error.message));
  run();
  const timer=setInterval(run,60*60*1000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports={startBillingJob};
