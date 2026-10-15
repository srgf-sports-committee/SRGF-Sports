(() => {
  "use strict";

  const API_URL = "https://script.google.com/macros/s/AKfycbyLw0Yvg1xwH0JTStGa7buZ2k5AZ0OIigIursW0hOLTUWna3pwXAGga_Z80-5MEx6G5/exec";
  const GOOGLE_CLIENT_ID = "558722597292-0bod7pch3lnjb2j8421922rvtsdmjm1v.apps.googleusercontent.com";

  const statusEl = document.getElementById("auth-status");
  const signInWrap = document.getElementById("google-signin-wrap");
  const confirmation = document.getElementById("admin-confirmation");
  const verifiedEmail = document.getElementById("verified-email");
  const signOutButton = document.getElementById("sign-out-button");
  let currentCredential = "";

  function setStatus(message, state) {
    statusEl.textContent = message;
    statusEl.dataset.state = state || "info";
  }

  function resetSignIn(message) {
    currentCredential = "";
    confirmation.hidden = true;
    signInWrap.hidden = false;
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
      google.accounts.id.cancel();
      google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
        type: "standard", theme: "outline", size: "large", text: "signin_with",
        shape: "pill", logo_alignment: "left", width: 280
      });
    }
    setStatus(message || "Please sign in with your approved Google account.", "info");
  }

  async function handleGoogleCredential(response) {
    if (!response || !response.credential) {
      setStatus("Google sign-in did not return a credential. Please try again.", "error");
      return;
    }

    currentCredential = response.credential;
    signInWrap.hidden = true;
    setStatus("Verifying your administrator access…", "info");

    try {
      // The backend must verify the ID token and check the active SPORTS_ADMINS row.
      const result = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "adminauth", idToken: currentCredential })
      });
      if (!result.ok) throw new Error("The authentication service returned HTTP " + result.status + ".");
      const data = await result.json();

      if (!data || data.ok !== true || data.authorized !== true || String(data.role || "").toUpperCase() !== "ADMIN") {
        currentCredential = "";
        signInWrap.hidden = false;
        setStatus((data && data.error) || "This Google account is not authorised for SRGF Sports administration.", "error");
        return;
      }

      const email = String(data.email || "");
      verifiedEmail.textContent = email;
      confirmation.hidden = false;
      setStatus("Your account has been verified by the SRGF Sports backend.", "success");
    } catch (error) {
      currentCredential = "";
      signInWrap.hidden = false;
      setStatus("Could not verify admin access. The SRGF Sports Apps Script must support the adminauth action and be deployed. Please try again later.", "error");
      console.error("SRGF Sports admin authentication:", error);
    }
  }

  function initializeGoogleSignIn() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      setStatus("Loading Google sign-in…", "info");
      window.setTimeout(initializeGoogleSignIn, 250);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
      type: "standard", theme: "outline", size: "large", text: "signin_with",
      shape: "pill", logo_alignment: "left", width: 280
    });
  }

  signOutButton.addEventListener("click", () => resetSignIn("You have signed out of the admin session."));
  initializeGoogleSignIn();
})();