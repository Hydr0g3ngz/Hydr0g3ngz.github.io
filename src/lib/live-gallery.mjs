const mounted = new WeakSet();

/** Enhance real MP4 links; without JS or native dialog support they still work. */
export function mountLiveGallery(gallery) {
  if (mounted.has(gallery)) return;
  mounted.add(gallery);
  for (const trigger of gallery.querySelectorAll('[data-live-open]')) {
    const dialog = trigger.closest('.live-record')?.querySelector('dialog');
    const video = dialog?.querySelector('video');
    if (!dialog || !video || typeof dialog.showModal !== 'function') continue;

    trigger.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (dialog.open) return;
      try { dialog.showModal(); } catch { return; }
      event.preventDefault();
      // Playback follows an explicit Watch click. Native controls remain available
      // if browser playback policy prevents starting immediately.
      video.play()?.catch(() => {});
    });
    dialog.addEventListener('close', () => {
      video.pause();
      trigger.focus({ preventScroll: true });
    });
    // Native close events are queued; stop audio in the initiating event as well.
    dialog.addEventListener('cancel', () => video.pause());
    dialog.addEventListener('submit', () => video.pause());
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        video.pause();
        dialog.close();
      }
    });
  }
}
