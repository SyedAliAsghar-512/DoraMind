import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
 
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="splash"><div className="spinner" /></div>
  return user ? children : <Navigate to="/auth" replace />
}
 
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/chat/:chatId?" element={
            <ProtectedRoute><ChatPage /></ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}