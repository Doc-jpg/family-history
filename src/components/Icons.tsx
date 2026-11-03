// Small inline icons (16 to 22px), stroke-based so they match the type weight. No icon library.
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24', 'aria-hidden': true };
export const TreeIcon = () => <svg {...base}><path d="M12 21v-8" /><path d="M12 13c-3 0-6-2-7-6 4 0 7 2 7 6zm0-2c0-5 3-8 8-8-1 5-4 8-8 8z" /><path d="M7 21h10" /></svg>;
export const MapIcon = () => <svg {...base}><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></svg>;
export const TimeIcon = () => <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const LinkIcon = () => <svg {...base}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6" /></svg>;
export const AdminIcon = () => <svg {...base}><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="16" r="3" /></svg>;
export const SearchIcon = () => <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
export const HomeIcon = () => <svg {...base}><path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
export const PlusIcon = () => <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
export const FitIcon = () => <svg {...base}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>;
export const BackIcon = () => <svg {...base}><path d="m15 5-7 7 7 7" /></svg>;
export const PhotoIcon = () => <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-7 8" /></svg>;
export const MicIcon = () => <svg {...base}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
export const PenIcon = () => <svg {...base}><path d="m4 20 4-1L19 8l-3-3L5 16z" /><path d="m14 7 3 3" /></svg>;
export const CheckIcon = () => <svg {...base}><path d="m5 12 4.5 4.5L19 7" /></svg>;
export const PlayIcon = () => <svg {...base}><path d="M7 5v14l11-7z" /></svg>;
