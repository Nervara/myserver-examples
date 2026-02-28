<template>
  <div class="app-container">
    <div class="fluid-background">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
      <div class="overlay-glass"></div>
    </div>

    <main class="content">
      <div class="logo-wrapper">
        <svg class="vue-logo" viewBox="0 0 261.76 226.69" xmlns="http://www.w3.org/2000/svg">
          <path d="M161.096.001l-30.225 52.351L100.647.001H-.005l130.877 226.688L261.749.001z" fill="#41b883"/>
          <path d="M161.096.001l-30.225 52.351L100.647.001H52.346l78.526 136.01L209.398.001z" fill="#34495e"/>
        </svg>
        <div class="pulse-ring"></div>
      </div>
      
      <h1 class="title">Vue <span>V2</span> Energy</h1>
      <p class="subtitle">Experience the fluidity and power of Vue <br/> deployed seamlessly on myserver.</p>
      
      <div class="action-buttons">
        <button class="btn primary-btn">
          Explore Features
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button class="btn secondary-btn">Documentation</button>
      </div>

      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-number">24kb</div>
          <div class="stat-label">Minified + Gzipped</div>
        </div>
        <div class="divider"></div>
        <div class="stat-item">
          <div class="stat-number">∞</div>
          <div class="stat-label">Possibilities</div>
        </div>
        <div class="divider"></div>
        <div class="stat-item">
          <div class="stat-number">0config</div>
          <div class="stat-label">Deployment</div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;800;900&display=swap');

:root {
  --vue-green: #41b883;
  --vue-blue: #34495e;
  --bg-dark: #0f172a;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-dark);
  font-family: 'Poppins', sans-serif;
  color: #fff;
  overflow-x: hidden;
}

.app-container {
  min-height: 100vh;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Fluid Animated Background */
.fluid-background {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  overflow: hidden;
  z-index: 0;
  background: #0b1120;
}

.blob {
  position: absolute;
  filter: blur(80px);
  border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
  animation: morph 15s ease-in-out infinite both alternate;
  opacity: 0.6;
}

.blob-1 {
  background: var(--vue-green);
  width: 600px; height: 600px;
  top: -200px; left: -100px;
  animation-delay: 0s;
}
.blob-2 {
  background: var(--vue-blue);
  width: 500px; height: 500px;
  bottom: -150px; right: 10%;
  animation-delay: -5s;
  animation-direction: alternate-reverse;
}
.blob-3 {
  background: #10b981; /* Emerald */
  width: 400px; height: 400px;
  top: 40%; left: 40%;
  animation-delay: -10s;
}

@keyframes morph {
  0%, 100% { border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%; transform: rotate(0deg) scale(1); }
  34% { border-radius: 70% 30% 50% 50% / 30% 30% 70% 70%; transform: rotate(120deg) scale(1.1); }
  67% { border-radius: 100% 60% 60% 100% / 100% 100% 60% 60%; transform: rotate(240deg) scale(0.9); }
}

.overlay-glass {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(60px);
  -webkit-backdrop-filter: blur(60px);
}

/* Main Content */
.content {
  position: relative;
  z-index: 10;
  text-align: center;
  width: 90%;
  max-width: 800px;
  animation: slide-up 1s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

.logo-wrapper {
  position: relative;
  width: 150px;
  height: 150px;
  margin: 0 auto 2rem;
  display: flex;
  justify-content: center;
  align-items: center;
}

.vue-logo {
  width: 120px;
  z-index: 2;
  filter: drop-shadow(0 15px 25px rgba(65, 184, 131, 0.4));
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.logo-wrapper:hover .vue-logo {
  transform: scale(1.1) rotate(5deg);
}

.pulse-ring {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 100%; height: 100%;
  border-radius: 50%;
  border: 2px solid var(--vue-green);
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  z-index: 1;
}

@keyframes pulse-ring {
  0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; border-width: 4px; }
  100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; border-width: 0; }
}

.title {
  font-size: 4.5rem;
  font-weight: 900;
  margin: 0;
  letter-spacing: -2px;
  line-height: 1.1;
  background: linear-gradient(135deg, #fff 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.title span {
  background: linear-gradient(to right, var(--vue-green), #10b981);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  font-size: 1.25rem;
  color: #94a3b8;
  margin: 1.5rem 0 3rem;
  font-weight: 300;
  line-height: 1.6;
}

.action-buttons {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  margin-bottom: 4rem;
}

.btn {
  padding: 1rem 2rem;
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 600;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.primary-btn {
  background: var(--vue-green);
  color: #fff;
  border: none;
  box-shadow: 0 10px 20px -5px rgba(65, 184, 131, 0.5);
}
.primary-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 15px 25px -5px rgba(65, 184, 131, 0.6);
  background: #3eb27f;
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
}
.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.stats-row {
  display: inline-flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
  padding: 1.5rem 2.5rem;
  border-radius: 20px;
  gap: 2rem;
}

.divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-number {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--vue-green);
  line-height: 1;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.8rem;
  color: #94a3b8;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}
</style>
