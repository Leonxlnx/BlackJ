// The bridge from preload.cjs. In a plain browser (design preview) main.jsx installs a mock first.
export const api = window.blackj;
export const isPreview = !!window.blackj?.isMock;
