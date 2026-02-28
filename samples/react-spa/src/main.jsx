import React from 'react'
import ReactDOM from 'react-dom/client'

const App = () => {
  return (
    <div style={{
      fontFamily: '"Plus Jakarta Sans", sans-serif',
      backgroundColor: '#000',
      color: '#fff',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      textAlign: 'center'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;500;800&display=swap');
        
        @keyframes float {
          0% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
        
        .logo {
          width: 120px;
          height: 120px;
          margin-bottom: 40px;
          animation: float 6s ease-in-out infinite;
          filter: drop-shadow(0 0 20px rgba(97, 218, 251, 0.5));
        }
        
        h1 {
          font-size: 4rem;
          font-weight: 800;
          margin: 0;
          letter-spacing: -0.05em;
          background: linear-gradient(135deg, #61dafb 0%, #d63384 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        p {
          font-size: 1.25rem;
          color: #888;
          max-width: 500px;
          margin: 20px 0 40px;
          line-height: 1.6;
        }
        
        .btn {
          background: #fff;
          color: #000;
          padding: 15px 35px;
          border-radius: 12px;
          font-weight: 700;
          text-decoration: none;
          transition: transform 0.2s, background 0.2s;
        }
        
        .btn:hover {
          transform: scale(1.05);
          background: #61dafb;
        }
      `}</style>
      
      <svg className="logo" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#61dafb" strokeWidth="2" />
        <path d="M50 20 L80 80 L20 80 Z" fill="#61dafb" opacity="0.8" />
      </svg>
      
      <h1>React + Vite</h1>
      <p>Premium Single Page Application successfully deployed using Static Buildpacks on myserver.</p>
      
      <a href="#" className="btn">Get Started</a>
      
      <div style={{ marginTop: '80px', color: '#444', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Sample Project: samples/react-spa
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
