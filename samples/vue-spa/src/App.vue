<template>
  <div class="app-container">
    <div class="glow"></div>
    <div class="content">
      <div class="vue-logo">
        <div class="v-shape"></div>
      </div>
      <h1>Vue.js</h1>
      <p>The Progressive JavaScript Framework, served with style on myserver.</p>
      
      <div class="feature-grid">
        <div class="feature">
          <h3>Fast</h3>
          <p>Built with Vite</p>
        </div>
        <div class="feature">
          <h3>Modern</h3>
          <p>Vue 3 + Composition API</p>
        </div>
        <div class="feature">
          <h3>Scalable</h3>
          <p>myserver Ready</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;600;900&display=swap');

:root {
  --vue-green: #42b883;
  --vue-blue: #35495e;
}

body {
  margin: 0;
  padding: 0;
  background-color: #0c0c0e;
  font-family: 'Outfit', sans-serif;
  color: #fff;
  overflow-x: hidden;
}

.app-container {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}

.glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(66, 184, 131, 0.1) 0%, transparent 70%);
  pointer-events: none;
}

.content {
  text-align: center;
  z-index: 1;
  padding: 2rem;
}

.vue-logo {
  width: 100px;
  height: 100px;
  margin: 0 auto 40px;
  position: relative;
}

.v-shape {
  width: 100%;
  height: 100%;
  background: var(--vue-green);
  clip-path: polygon(50% 100%, 0 0, 20% 0, 50% 60%, 80% 0, 100% 0);
  filter: drop-shadow(0 10px 20px rgba(66, 184, 131, 0.4));
}

h1 {
  font-size: 5rem;
  font-weight: 900;
  margin: 0;
  letter-spacing: -3px;
  color: #fff;
}

p {
  color: #888;
  font-size: 1.25rem;
  margin: 1rem 0 4rem;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  max-width: 800px;
}

.feature {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 1.5rem;
  border-radius: 20px;
  transition: border-color 0.3s;
}

.feature:hover {
  border-color: var(--vue-green);
}

.feature h3 {
  margin: 0 0 0.5rem 0;
  color: var(--vue-green);
}

.feature p {
  margin: 0;
  font-size: 0.9rem;
  color: #666;
}
</style>
