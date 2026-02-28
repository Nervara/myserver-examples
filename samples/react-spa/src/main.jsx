import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'

const App = () => {
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('show');
        }
      });
    }, { threshold: 0.1 });

    const hiddenElements = document.querySelectorAll('.animate-on-scroll');
    hiddenElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      backgroundColor: '#fbfbfd',
      color: '#1d1d1f',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '0',
      margin: '0',
      overflowX: 'hidden'
    }}>
      <style>{`
        body { margin: 0; padding: 0; }
        
        .hero-section {
            height: 100vh;
            width: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            position: relative;
        }

        .react-logo {
            width: 140px;
            height: 140px;
            margin-bottom: 20px;
            animation: spin 20s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .headline {
            font-size: 5rem;
            font-weight: 700;
            letter-spacing: -0.015em;
            margin: 0;
            background: linear-gradient(135deg, #1d1d1f 0%, #434346 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .subhead {
            font-size: 1.75rem;
            font-weight: 400;
            letter-spacing: 0.012em;
            color: #86868b;
            margin-top: 10px;
            max-width: 600px;
        }

        .pricing {
            font-size: 1.1rem;
            color: #86868b;
            margin-top: 30px;
        }

        .btn-group {
            display: flex;
            gap: 20px;
            margin-top: 30px;
        }

        .btn {
            background: #0071e3;
            color: #fff;
            padding: 12px 24px;
            border-radius: 980px;
            font-size: 1.1rem;
            font-weight: 400;
            text-decoration: none;
            transition: background 0.3s;
        }
        .btn:hover { background: #0077ed; }
        
        .btn-secondary {
            background: transparent;
            color: #0071e3;
            border: 1px solid rgba(0, 113, 227, 0);
        }
        .btn-secondary:hover { color: #0077ed; background: transparent; }

        /* Scroll Animations */
        .animate-on-scroll {
            opacity: 0;
            filter: blur(5px);
            transform: translateY(30px);
            transition: all 1s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .animate-on-scroll.show {
            opacity: 1;
            filter: blur(0);
            transform: translateY(0);
        }

        .feature-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 2rem;
            max-width: 1000px;
            width: 90%;
            padding: 100px 0;
        }

        .feature-card {
            background: #ffffff;
            border-radius: 24px;
            padding: 40px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.04);
            text-align: center;
        }

        .feature-icon {
            font-size: 3rem;
            margin-bottom: 20px;
            color: #1d1d1f;
        }

        .feature-title {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 15px;
        }

        .feature-desc {
            font-size: 1.1rem;
            color: #86868b;
            line-height: 1.5;
        }
      `}</style>

      <section className="hero-section">
        <svg className="react-logo animate-on-scroll" viewBox="-11.5 -10.23174 23 20.46348" style={{transitionDelay: '100ms'}}>
          <circle cx="0" cy="0" r="2.05" fill="#61dafb"/>
          <g stroke="#61dafb" strokeWidth="1" fill="none">
            <ellipse rx="11" ry="4.2"/>
            <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
            <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
          </g>
        </svg>
        <h1 className="headline animate-on-scroll" style={{transitionDelay: '200ms'}}>React. Pro.</h1>
        <p className="subhead animate-on-scroll" style={{transitionDelay: '300ms'}}>
            The most advanced UI library ever built, running flawlessly on myserver's static engine.
        </p>
        <p className="pricing animate-on-scroll" style={{transitionDelay: '400ms'}}>Starting at 0ms latency.</p>
        
        <div className="btn-group animate-on-scroll" style={{transitionDelay: '500ms'}}>
            <a href="#" className="btn">Deploy Now</a>
            <a href="#" className="btn btn-secondary">Learn more &gt;</a>
        </div>
      </section>

      <div className="feature-grid">
        <div className="feature-card animate-on-scroll">
            <div className="feature-icon">⚡️</div>
            <div className="feature-title">Vite Powered</div>
            <div className="feature-desc">Experience lightning fast HMR and optimized production builds out of the box.</div>
        </div>
        <div className="feature-card animate-on-scroll" style={{transitionDelay: '200ms'}}>
            <div className="feature-icon">☁️</div>
            <div className="feature-title">myserver Ready</div>
            <div className="feature-desc">Zero configuration required. myserver automatically detects and builds your SPA.</div>
        </div>
      </div>
      
      <footer style={{ padding: '60px 0', color: '#86868b', fontSize: '12px', textAlign: 'center' }}>
          Sample Project // React SPA // Built for myserver V2
      </footer>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
