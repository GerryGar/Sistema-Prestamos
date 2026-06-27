// config.js - Configuración de Firebase
// REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO

const firebaseConfig = {
  apiKey: "AIzaSyBqbGD9au6p-G9XzoqM1Ggpd7I1lj3BvXU",
  authDomain: "sistema-prestamos-9c127.firebaseapp.com",
  projectId: "sistema-prestamos-9c127",
  storageBucket: "sistema-prestamos-9c127.firebasestorage.app",
  messagingSenderId: "341455296920",
  appId: "1:341455296920:web:fc48edb741a88fa064f3ed"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Habilitar persistencia offline
db.enablePersistence()
  .then(() => {
    console.log('✅ Persistencia offline habilitada');
  })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('⚠️ Persistencia no disponible (múltiples pestañas abiertas)');
    } else {
      console.error('❌ Error:', err);
    }
  });