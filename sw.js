self.addEventListener('install', e=>{
  e.waitUntil(caches.open('exam-mvp-v1').then(c=>c.addAll([
    './index.html','./admin.html','./styles.css','./app.js','./admin.js',
    './questions.sample.json','./manifest.json'
  ])));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
