import { createElement } from 'react';

export default function ReportHtmlView({ html }: { html: string }) {
  return createElement('iframe', {
    key: html,
    srcDoc: html,
    style: {
      flex: 1,
      width: '100%',
      height: '100%',
      border: 'none',
      background: '#fff',
    },
  });
}
