import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BadgePercent, Boxes, CalendarClock, CreditCard, FileCheck2, FileText, LayoutDashboard, LogOut, Menu, Package, Users, X } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { initials } from './api';
import { Loading, Toast } from './components/UI';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import PlansPage from './pages/PlansPage';
import DiscountsPage from './pages/DiscountsPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import InvoicesPage from './pages/InvoicesPage';
import PaymentsPage from './pages/PaymentsPage';
import QuotationsPage from './pages/QuotationsPage';
import TeamPage from './pages/TeamPage';

function Brand() {
  return <div className="brand"><span className="brand-mark"/><div><div className="brand-name">brightloop</div><div className="brand-caption">subscription ledger</div></div></div>;
}
function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Opening your workspace"/>;
  if (!user) return <Navigate to="/" replace/>;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace/>;
  return children;
}
function Shell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const isAdmin = user?.role === 'admin';
  const isStaff = user?.role === 'staff';
  useEffect(() => {
    const listener = (event) => setToast({ message: event.detail, type: 'success' });
    window.addEventListener('brightloop-toast', listener);
    return () => window.removeEventListener('brightloop-toast', listener);
  }, []);
  const nav = [{ heading: 'Workspace', items: [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { to: '/subscriptions', label: 'Subscriptions', icon: CalendarClock },
    { to: '/invoices', label: 'Invoices', icon: FileText },
    { to: '/payments', label: 'Payments', icon: CreditCard },
  ] }];
  if (isAdmin || isStaff) {
    nav.push({ heading: 'Manage', items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/plans', label: 'Plans', icon: Boxes },
      ...(isAdmin ? [{ to: '/discounts', label: 'Discounts', icon: BadgePercent }] : []),
      { to: '/quotes', label: 'Quotations', icon: FileCheck2 },
      { to: '/customers', label: isAdmin ? 'Customers & team' : 'Customers', icon: Users },
    ] });
  } else {
    nav.push({ heading: 'Account', items: [{ to: '/quotes', label: 'Quotations', icon: FileCheck2 }] });
  }
  const titleMap = { dashboard:'Overview', subscriptions:'Subscriptions', invoices:'Invoices', payments:'Payments', products:'Products', plans:'Plans', discounts:'Discounts', quotes:'Quotations', customers:'Customers' };
  const title = titleMap[location.pathname.split('/')[1]] || 'Overview';
  return <div className="app-shell">
    <div className="mobile-top"><button className="icon-button" onClick={() => setMenuOpen(v => !v)} aria-label="Open menu">{menuOpen ? <X size={19}/> : <Menu size={19}/>}</button><div className="mobile-brand"><span className="brand-mark"/>brightloop</div><span className="avatar">{initials(user?.fullName)}</span></div>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}><Brand/><nav>{nav.map(group => <div className="nav-group" key={group.heading}><div className="nav-caption">{group.heading}</div>{group.items.map(item => <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><item.icon size={17} strokeWidth={1.8}/>{item.label}</NavLink>)}</div>)}</nav>
      <div className="nav-bottom"><div className="workspace-label">Brightloop Software</div><div className="profile-row"><span className="avatar dark">{initials(user?.fullName)}</span><div><div className="profile-name">{user?.fullName}</div><div className="profile-role">{user?.role}</div></div><button className="logout-button" title="Sign out" onClick={async () => { await logout(); navigate('/'); }}><LogOut size={15}/></button></div></div>
    </aside><div className="main-area"><header className="topbar"><div className="breadcrumbs">Brightloop&nbsp; / &nbsp;<strong>{title}</strong></div><div className="topbar-right"><span className="live-indicator"><i className="live-dot"/>Session verified</span><span className="avatar">{initials(user?.fullName)}</span></div></header><main className="content">{children}</main></div>
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </div>;
}
const inShell = (page, roles) => <Protected roles={roles}><Shell>{page}</Shell></Protected>;
export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Opening your workspace"/>;
  return <Routes>
    <Route path="/" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage mode="login"/>}/>
    <Route path="/register" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage mode="register"/>}/>
    <Route path="/forgot-password" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage mode="forgot"/>}/>
    <Route path="/reset-password" element={user ? <Navigate to="/dashboard" replace/> : <AuthPage mode="reset"/>}/>
    <Route path="/dashboard" element={inShell(<DashboardPage/>)}/>
    <Route path="/products" element={inShell(<ProductsPage/>, ['admin','staff'])}/>
    <Route path="/plans" element={inShell(<PlansPage/>, ['admin','staff'])}/>
    <Route path="/discounts" element={inShell(<DiscountsPage/>, ['admin'])}/>
    <Route path="/subscriptions" element={inShell(<SubscriptionsPage/>)}/>
    <Route path="/invoices" element={inShell(<InvoicesPage/>)}/>
    <Route path="/payments" element={inShell(<PaymentsPage/>)}/>
    <Route path="/quotes" element={inShell(<QuotationsPage/>)}/>
    <Route path="/customers" element={inShell(<TeamPage/>, ['admin','staff'])}/>
    <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace/>}/>
  </Routes>;
}
