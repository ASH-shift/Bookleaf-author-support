import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import MyBooks from './pages/author/MyBooks.jsx';
import MyTickets from './pages/author/MyTickets.jsx';
import NewTicket from './pages/author/NewTicket.jsx';
import AuthorTicketDetail from './pages/author/TicketDetail.jsx';
import Queue from './pages/admin/Queue.jsx';
import AdminTicketDetail from './pages/admin/TicketDetail.jsx';

// Route guards here are for UX only; the API enforces every permission server-side.
export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;

  const home = user.role === 'admin' ? '/admin' : '/books';
  return (
    <Routes>
      <Route element={<Layout />}>
        {user.role === 'author' && <>
          <Route path="/books" element={<MyBooks />} />
          <Route path="/tickets" element={<MyTickets />} />
          <Route path="/tickets/new" element={<NewTicket />} />
          <Route path="/tickets/:id" element={<AuthorTicketDetail />} />
        </>}
        {user.role === 'admin' && <>
          <Route path="/admin" element={<Queue />} />
          <Route path="/admin/tickets/:id" element={<AdminTicketDetail />} />
        </>}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
