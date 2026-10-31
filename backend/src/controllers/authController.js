const { asyncHandler } = require('../middleware/errors');
const auth = require('../services/authService');

const signup = asyncHandler(async (req,res) => {
  const user=await auth.signup(req.body);auth.setSession(res,user);
  res.status(201).json({data:auth.publicUser(user)});
});
const login = asyncHandler(async (req,res) => {
  const user=await auth.login(req.body);auth.setSession(res,user);
  res.json({data:auth.publicUser(user)});
});
const logout = (_req,res) => {auth.clearSession(res);res.json({data:{signedOut:true}});};
const currentUser = (req,res) => res.json({data:auth.publicUser(req.user)});
const forgotPassword = asyncHandler(async (req,res) => {
  await auth.requestPasswordReset(req.body.email);
  res.json({data:{message:'If the address is registered, a reset link will be sent.'}});
});
const resetPassword = asyncHandler(async (req,res) => {
  await auth.resetPassword(req.body);
  res.json({data:{message:'Password updated. You can now sign in.'}});
});
module.exports={signup,login,logout,currentUser,forgotPassword,resetPassword};
