const db = require('../config/db');

const publicColumns = 'id,email,full_name,role,is_active,created_at';
function findByEmail(email) {
  return db.query(`SELECT id,email,password_hash,full_name,role,is_active,token_version FROM users WHERE email=$1`, [email]);
}
function findActiveById(id) {
  return db.query(`SELECT ${publicColumns} FROM users WHERE id=$1 AND is_active=TRUE`, [id]);
}
function createCustomer({ email, passwordHash, fullName }) {
  return db.query(`INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,'customer') RETURNING id,email,full_name,role`, [email,passwordHash,fullName]);
}
module.exports = { findByEmail, findActiveById, createCustomer };
