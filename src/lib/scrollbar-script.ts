/** Inline head script (ES5): marks `<html data-scrollbars="classic">` when the
    platform draws scrollbars that take up room (Windows, or macOS with a mouse
    set to always show them). globals.css then gives every scroller the thin,
    arrowless app scrollbar instead of the stock grey one. Overlay scrollbars
    (macOS trackpad, phones) measure 0 wide and are left alone. */
export const SCROLLBAR_SCRIPT =
  '(function(){try{var e=document.documentElement,p=document.createElement("div");p.style.cssText="position:absolute;top:-999px;width:100px;height:100px;overflow:scroll";e.appendChild(p);if(p.offsetWidth-p.clientWidth>0)e.dataset.scrollbars="classic";e.removeChild(p)}catch(x){}})()';
