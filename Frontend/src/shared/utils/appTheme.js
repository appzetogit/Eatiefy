/**
 * Dark mode is a *user app* preference, not a global one.
 *
 * The toggle lives in the user app's Profile page, but the `dark` class it sets
 * goes on <html>, which every module shares - so turning it on there also
 * darkened the restaurant, delivery and admin panels. Those panels are
 * light-only and have no toggle of their own.
 *
 * The class has to stay on <html> (portalled modals and dialogs render outside
 * the user layout's subtree and would otherwise lose their dark styling), so
 * instead it is applied or removed per route: on for the user app, off
 * everywhere else.
 */

export const THEME_STORAGE_KEY = "appTheme"

const THEMED_PATH_PREFIXES = ["/food/user", "/user"]

/** True only for routes belonging to the user app. */
export const isThemedPath = (pathname) => {
  const path = String(pathname || "")
  return THEMED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

export const getSavedTheme = () => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "light"
  } catch {
    return "light"
  }
}

export const saveTheme = (theme) => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme === "dark" ? "dark" : "light")
  } catch {
    /* private mode - the class below still applies for this session */
  }
}

/**
 * Applies the saved theme when the route belongs to the user app, and forces
 * light everywhere else. Safe to call on every navigation.
 */
export const applyThemeForPath = (pathname) => {
  if (typeof document === "undefined") return false
  const useDark = isThemedPath(pathname) && getSavedTheme() === "dark"
  document.documentElement.classList.toggle("dark", useDark)
  return useDark
}
