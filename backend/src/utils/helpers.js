const { AppError } = require('../middleware/errors');

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}
function assertOwnerOrStaff(user, customerId) {
  if (user.role === 'customer' && String(user.id) !== String(customerId)) {
    throw new AppError(404, 'NOT_FOUND', 'Record was not found');
  }
}
function addPeriod(dateString, period, amount = 1) {
  const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (period === 'daily') date.setUTCDate(date.getUTCDate() + amount);
  else if (period === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * amount);
  else if (period === 'monthly') {
    const target = new Date(Date.UTC(year, month - 1 + amount, 1));
    const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, maxDay));
  } else if (period === 'yearly') {
    const targetYear = year + amount;
    const maxDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    date.setUTCFullYear(targetYear, month - 1, Math.min(day, maxDay));
  }
  return date.toISOString().slice(0, 10);
}
function endOfPeriod(start, nextStart) {
  const date = new Date(`${nextStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function makeNumber(prefix) {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}-${random}`;
}
module.exports = { pagination, assertOwnerOrStaff, addPeriod, endOfPeriod, makeNumber };
