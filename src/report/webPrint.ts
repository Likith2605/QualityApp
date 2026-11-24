export function openHtmlOnWeb(html: string, autoPrint: boolean): void {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('The browser blocked the report window. Allow pop-ups for this site and try again.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  const print = () => {
    win.focus();
    if (autoPrint) win.print();
  };
  win.addEventListener('load', print, { once: true });
  win.setTimeout(print, 250);
}
