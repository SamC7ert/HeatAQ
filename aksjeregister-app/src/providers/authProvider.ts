import type { AuthProvider } from "@refinedev/core";
import { supabaseClient } from "../supabaseClient";

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        success: false,
        error: {
          name: "LoginError",
          message: error.message,
        },
      };
    }

    if (data?.user) {
      return {
        success: true,
        redirectTo: "/",
      };
    }

    return {
      success: false,
      error: {
        name: "LoginError",
        message: "Ukjent feil ved innlogging",
      },
    };
  },

  logout: async () => {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      return {
        success: false,
        error: {
          name: "LogoutError",
          message: error.message,
        },
      };
    }

    return {
      success: true,
      redirectTo: "/login",
    };
  },

  check: async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (data?.session) {
      return {
        authenticated: true,
      };
    }

    return {
      authenticated: false,
      redirectTo: "/login",
    };
  },

  getPermissions: async () => {
    const { data } = await supabaseClient.auth.getUser();

    if (data?.user) {
      // TODO: Fetch user role from organization_members
      return null;
    }

    return null;
  },

  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser();

    if (data?.user) {
      return {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.full_name || data.user.email,
      };
    }

    return null;
  },

  register: async ({ email, password, fullName }) => {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      return {
        success: false,
        error: {
          name: "RegisterError",
          message: error.message,
        },
      };
    }

    if (data?.user) {
      return {
        success: true,
        redirectTo: "/login",
        successNotification: {
          message: "Registrering vellykket",
          description: "Sjekk e-posten din for bekreftelseslenke",
        },
      };
    }

    return {
      success: false,
      error: {
        name: "RegisterError",
        message: "Ukjent feil ved registrering",
      },
    };
  },

  forgotPassword: async ({ email }) => {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      return {
        success: false,
        error: {
          name: "ForgotPasswordError",
          message: error.message,
        },
      };
    }

    return {
      success: true,
      successNotification: {
        message: "E-post sendt",
        description: "Sjekk e-posten din for lenke til å tilbakestille passord",
      },
    };
  },

  updatePassword: async ({ password }) => {
    const { error } = await supabaseClient.auth.updateUser({
      password,
    });

    if (error) {
      return {
        success: false,
        error: {
          name: "UpdatePasswordError",
          message: error.message,
        },
      };
    }

    return {
      success: true,
      redirectTo: "/",
      successNotification: {
        message: "Passord oppdatert",
        description: "Passordet ditt er nå endret",
      },
    };
  },

  onError: async (error) => {
    console.error(error);
    return { error };
  },
};
