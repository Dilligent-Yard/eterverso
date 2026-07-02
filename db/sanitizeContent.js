const sanitizeHtml = require('sanitize-html');

const richTextOptions = {
  allowedTags: [
    'p', 'div', 'span', 'br', 'hr',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'small',
    'h1', 'h2', 'h3', 'h4', 'pre', 'code', 'blockquote',
    'ul', 'ol', 'li',
    'a', 'img', 'font',
    'table', 'thead', 'tbody', 'tr', 'td', 'th'
  ],
  allowedAttributes: {
    a: ['href'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['color', 'face', 'size'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    span: ['class', 'style'],
    '*': ['style']
  },
  allowedClasses: {
    span: ['spoiler']
  },
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-family': [/^[\w\s,'"-]+$/],
      'font-size': [/^[\d.]+(px|em|rem|%|pt)$/, /^(x-)?(small|large)r?$/, /^medium$/],
      'margin-left': [/^[\d.]+(px|em|rem)$/],
      'padding-left': [/^[\d.]+(px|em|rem)$/]
    }
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false
};

function sanitizeRichText(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), richTextOptions);
}

function sanitizeUrlField(value, maxLen) {
  var url = String(value || '').trim();
  if (!url) return '';
  if (url.length > (maxLen || 600)) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

module.exports = { sanitizeRichText, sanitizeUrlField };
