export const usernamePattern = /^[a-z][a-z0-9_]{2,19}$/;
export const initialsPattern = /^[A-Z0-9]{3}$/;

export function normalizeInitials(value: string) {
  return value.trim().toUpperCase();
}

export function validateUsername(value: string) {
  if (!usernamePattern.test(value.trim())) {
    return "El username debe tener 3-20 caracteres, empezar por letra minúscula y usar solo minúsculas, números o guion bajo.";
  }

  return null;
}

export function validateInitials(value: string) {
  if (!initialsPattern.test(normalizeInitials(value))) {
    return "Las siglas deben tener exactamente 3 caracteres: letras A-Z o números.";
  }

  return null;
}

export function validatePassword(value: string) {
  if (value.length < 6) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }

  return null;
}

export function humanizeSupabaseError(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Email o contraseña incorrectos.";
  }

  if (lower.includes("email") && lower.includes("invalid")) {
    return "El email no parece válido.";
  }

  if (lower.includes("password")) {
    return "La contraseña no cumple los requisitos de Supabase.";
  }

  if (lower.includes("profiles_username_lower_unique_idx")) {
    return "Ese username ya está usado.";
  }

  if (lower.includes("profiles_initials_upper_unique_idx")) {
    return "Esas siglas ya están usadas.";
  }

  if (lower.includes("duplicate key")) {
    return "El username o las siglas ya están en uso.";
  }

  if (lower.includes("email not confirmed")) {
    return "El email está pendiente de confirmación.";
  }

  return message;
}
