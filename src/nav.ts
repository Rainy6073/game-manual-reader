export const navigate = (path: string) => {
  window.location.hash = `/${path}`
}

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
