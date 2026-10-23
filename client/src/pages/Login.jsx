import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: 'admin@taskflow.dev', password: 'Password@123' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
    } catch (err) {
      const fieldErrors = err.details?.fieldErrors;
      setError(fieldErrors ? Object.values(fieldErrors).flat().join('. ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-intro">
        <h1>See where work waits.</h1>
        <p>
          A shared board for your team, with every move recorded so you can measure cycle time, review bounce-backs and
          bottlenecks — not guess at them.
        </p>
        <div className="flow-demo" aria-hidden>
          <span className="s-todo" style={{ flex: 6 }} />
          <span className="s-in_progress" style={{ flex: 2 }} />
          <span className="s-in_review" style={{ flex: 1.6 }} />
          <span className="s-blocked" style={{ flex: 0.6 }} />
        </div>
        <p className="muted small">Typical task: most of its life is spent waiting in To do.</p>
        <p className="proto-note">
          This is a prototype for demonstration. For a production version,{' '}
          <a href="mailto:bhaskardwivedi.24112004@gmail.com?subject=TaskFlow%20—%20production%20enquiry">contact the owner</a>.
        </p>
      </section>
      <form className="login-form" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create an account'}</h2>
        {mode === 'register' && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} required minLength={2} />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        {mode === 'login' && <p className="muted small">Demo: admin@taskflow.dev or manager@taskflow.dev, password Password@123</p>}
      </form>
    </div>
  );
}
