const form = document.getElementById("signin-form");
const submit = document.getElementById("submit");
const status = document.getElementById("status");
const password = document.getElementById("password");
const returnButton = document.getElementById("return");
let busy = false;

async function send(request) {
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok)
    throw new Error(response?.error || "UniMate couldn’t connect. Please try again.");
  return response.data;
}

function showStatus(message, error = false) {
  status.textContent = message;
  status.className = error ? "error" : "";
  status.setAttribute("role", error ? "alert" : "status");
}

document.getElementById("show-password").addEventListener("change", (event) => {
  password.type = event.target.checked ? "text" : "password";
});
returnButton.addEventListener("click", () => window.close());
document.getElementById("open-account").addEventListener("click", async () => {
  try {
    await send({ type: "OPEN_ACCOUNT_HELP" });
  } catch {
    showStatus("We couldn’t open your account page. Please try again.", true);
  }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  submit.disabled = true;
  submit.textContent = "Signing in…";
  showStatus("");
  try {
    const auth = await send({
      type: "SIGN_IN",
      email: document.getElementById("email").value.trim(),
      password: password.value,
    });
    if (!auth?.authenticated) throw new Error("Please check your sign-in details and try again.");
    password.value = "";
    form.hidden = true;
    returnButton.hidden = false;
    showStatus(
      auth.isPro
        ? "You’re connected. Your study companion is ready on your page."
        : "You’re signed in. Your page will show how to unlock Companion with UniMate Pro.",
    );
    returnButton.focus();
    // Keep the confirmation visible and let the student explicitly return.
  } catch (error) {
    showStatus(error.message || "Sign-in didn’t work. Please try again.", true);
  } finally {
    busy = false;
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});
