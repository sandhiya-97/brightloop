const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const authController = require('../controllers/authController');
const router = express.Router();

const email = z.string().trim().email().max(254);
const password = z.string().min(9,'Password must be at least 9 characters')
  .regex(/[A-Z]/,'Password needs an uppercase letter')
  .regex(/[a-z]/,'Password needs a lowercase letter')
  .regex(/[^A-Za-z0-9]/,'Password needs a special character')
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer');
router.post('/signup',validate(z.object({email,password,fullName:z.string().trim().min(2).max(120)})),authController.signup);
router.post('/login',validate(z.object({email,password:z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer')})),authController.login);
router.post('/logout',authController.logout);
router.get('/me',requireAuth,authController.currentUser);
router.post('/forgot-password',validate(z.object({email})),authController.forgotPassword);
router.post('/reset-password',validate(z.object({token:z.string().min(20),password})),authController.resetPassword);
module.exports=router;
