import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Field, PrimaryButton } from '../components/UI';

const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;

export default function AuthPage({ mode = 'login' }) {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'login') {
        await login({ email: form.email, password: form.password });
        navigate('/dashboard');
      } else if (mode === 'register') {
        if (!passwordRule.test(form.password)) throw new Error('Use at least 9 characters with uppercase, lowercase, and a special character.');
        if (form.password !== form.confirm) throw new Error('Passwords do not match.');
        await signup({ fullName: form.fullName, email: form.email, password: form.password });
        navigate('/dashboard');
      } else if (mode === 'forgot') {
        const result = await api('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setNotice(result.data.message);
      } else {
        if (!passwordRule.test(form.password)) throw new Error('Use at least 9 characters with uppercase, lowercase, and a special character.');
        if (form.password !== form.confirm) throw new Error('Passwords do not match.');
        const result = await api('/auth/reset-password', {
          method: 'POST', body: { token: params.get('token'), password: form.password },
        });
        setNotice(result.data.message);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const heading = {
    login: 'Sign in', register: 'Create your account',
    forgot: 'Reset your password', reset: 'Choose a new password',
  }[mode];
  const intro = {
    login: 'Your subscriptions, invoices, and cash flow—reconciled in one place.',
    register: 'Set up your customer portal to track subscriptions and invoices.',
    forgot: 'We’ll send a secure, one-time reset link if your address is registered.',
    reset: 'Choose a strong password to secure your Brightloop account.',
  }[mode];

  return (
    <div className="auth-screen">
      <aside className="auth-aside">
        <div>
          <div className="brand"><span className="brand-mark"/><div><div className="brand-name">brightloop</div><div className="brand-caption">subscription ledger</div></div></div>
          <h1>Renewals,<br/>reconciled.</h1>
          <p>Subscription operations made clear—from the first quote to the final payment.</p>
        </div>
        <div className="auth-aside-foot">Brightloop Software · Finance operations</div>
      </aside>
      <main className="auth-main">
        <section className="auth-card">
          <div className="brand"><span className="brand-mark"/><div><div className="brand-name">brightloop</div><div className="brand-caption">subscription ledger</div></div></div>
          <h2>{heading}</h2><p>{intro}</p>
          {notice && <div className="auth-message"><ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 6 }}/>{notice}</div>}
          {error && <div className="error-banner"><span>{error}</span></div>}
          <form className="form-stack" onSubmit={submit}>
            {mode === 'register' && <Field label="Full name"><input autoComplete="name" className="input-control" value={form.fullName} onChange={set('fullName')} required minLength={2}/></Field>}
            {mode !== 'reset' && <Field label="Email address"><input autoComplete="email" className="input-control" type="email" value={form.email} onChange={set('email')} required/></Field>}
            {['login', 'register', 'reset'].includes(mode) && <Field label="Password" hint={mode === 'login' ? '' : '9+ characters with uppercase, lowercase, and a special character'}><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="input-control" type="password" value={form.password} onChange={set('password')} required minLength={mode === 'login' ? 1 : 9}/></Field>}
            {['register', 'reset'].includes(mode) && <Field label="Confirm password"><input autoComplete="new-password" className="input-control" type="password" value={form.confirm} onChange={set('confirm')} required/></Field>}
            {mode === 'login' && <div style={{ textAlign: 'right', marginTop: -6 }}><Link className="link-button" to="/forgot-password">Forgot password?</Link></div>}
            <PrimaryButton type="submit" disabled={busy}>{busy ? 'Please wait' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create customer account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}{!busy && <ArrowRight size={15}/>}</PrimaryButton>
          </form>
          <div className="auth-switch">
            {mode === 'login' ? <>New to Brightloop? <Link to="/register">Create customer account</Link></>
              : mode === 'register' ? <>Already have an account? <Link to="/">Sign in</Link></>
                : mode === 'forgot' ? <Link to="/">Back to sign in</Link>
                  : notice ? <Link to="/">Back to sign in</Link>
                    : <Link to="/forgot-password">Request another reset link</Link>}
          </div>
          <p style={{ marginTop: 28, fontSize: 10, textAlign: 'center' }}>Protected access · Passwords are securely hashed</p>
        </section>
      </main>
    </div>
  );
}
