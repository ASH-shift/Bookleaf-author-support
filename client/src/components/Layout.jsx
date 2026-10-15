import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const AUTHOR_NAV = [
  { to: '/books', label: 'My Books' },
  { to: '/tickets', label: 'My Tickets' },
  { to: '/tickets/new', label: 'Get Help' },
];
const ADMIN_NAV = [{ to: '/admin', label: 'Ticket Queue' }];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = user.role === 'admin' ? ADMIN_NAV : AUTHOR_NAV;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          BookLeaf <span>{user.role === 'admin' ? 'Support Desk' : 'Author Portal'}</span>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end>{n.label}</NavLink>
          ))}
        </nav>
        <div className="user">
          <span>{user.name}</span>
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
