// VEYE — website interactivity
(function () {
  // Mobile nav toggle
  var burger = document.getElementById('navBurger');
  var links = document.getElementById('navLinks');
  if (burger && links) {
    burger.addEventListener('click', function () { links.classList.toggle('open'); });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') links.classList.remove('open');
    });
  }

  // Smooth scroll for in-page anchors (accounting for sticky header)
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });

  // Video: click-to-play custom overlay.
  // The overlay is hidden by `.video.is-playing .video__play`, so the class has
  // to go on the <section class="video">, not on .video__frame — that mismatch
  // is why the play button stayed visible during playback. The class is now
  // driven by the video's own events, so it stays correct however playback
  // starts or stops (overlay, native controls, keyboard, end of file).
  var video = document.getElementById('veyeVideo');
  var play = document.getElementById('videoPlay');
  var section = video && video.closest ? video.closest('.video') : null;
  if (section && video && play) {
    play.addEventListener('click', function (e) {
      // stop the click reaching the video underneath, which would toggle it
      // straight back to paused in the same gesture
      e.preventDefault();
      e.stopPropagation();
      video.setAttribute('controls', 'controls');
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    });
    function playing() { section.classList.add('is-playing'); }
    function idle() { section.classList.remove('is-playing'); }
    video.addEventListener('play', playing);
    video.addEventListener('playing', playing);
    video.addEventListener('pause', idle);
    video.addEventListener('ended', idle);
  }

  // Scroll reveal (subtle) for sections
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.style.opacity = 1; en.target.style.transform = 'none'; io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.step, .feature, .band, .split__body').forEach(function (el) {
      el.style.opacity = 0;
      el.style.transform = 'translateY(18px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
  }
})();
