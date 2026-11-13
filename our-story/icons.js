// Local, font-independent icon set. No decorative arrows on actions.
const paths={
 photo:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.3" cy="9" r="1.4"/><path d="m4 17 5-5 3.4 3 3.8-5 4.8 7"/>',
 home:'<path d="m3 11 9-8 9 8M5 10v11h14V10"/><path d="M9 21v-7h6v7"/><path d="m12 8-1.2-1.1a1.3 1.3 0 0 0-1.8 1.9l3 2.7 3-2.7a1.3 1.3 0 0 0-1.8-1.9Z"/>',
 sprout:'<path d="M12 21v-9M12 15C4 15 3 10 3 5c6 0 10 2 9 10ZM12 12c0-6 4-9 10-9 0 6-3 10-10 9ZM5 21h14"/>',
 plane:'<path d="m21 3-5 18-4-8-9-4 18-6ZM12 13l9-10M8 16l-3 3"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><path d="m12 12-3-2.7a1.8 1.8 0 0 1 3-1.8 1.8 1.8 0 0 1 3 1.8Z"/>',
 heart:'<path d="m12 21-8-7.5a5.2 5.2 0 0 1 8-6.7 5.2 5.2 0 0 1 8 6.7Z"/>',
 folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
};
export function icon(name,className='story-icon') {
 return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths.photo}</svg>`;
}
