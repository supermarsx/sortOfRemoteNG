// Reduced from unauthenticated https://porkbun.com/account/login and its
// /js/skaboink.js on 2026-09-30. All dynamic values below are synthetic.
// Keep the external button, dummy iframe target and distinct challenge panels.
export const porkbunLoginHtml = `
<div id="accountLoginContainer">
  <div id="accountLoginErrorAlert" style="display:none"></div>
  <iframe name="lame_login_iframe" class="hidden"></iframe>
  <form id="loginForm" target="lame_login_iframe" action="/blank" method="POST" data-pbrf="fixture-site-managed">
    <fieldset>
      <input type="hidden" name="redir" value="">
      <input type="text" id="loginUsername" name="loginUsername" autocomplete="username">
      <input type="password" id="loginPassword" name="loginPassword" autocomplete="current-password">
      <div id="accountLoginCheckCaptcha"><input type="hidden" id="porkcaptcha-token_accountLogin" name="porkcaptcha-token_accountLogin" value="fixture-site-managed"></div>
      <div id="twoFactorLoginContainer" style="display:none">
        <input type="text" id="twoFactorLoginCode" autocomplete="one-time-code">
      </div>
      <div id="twoFactorLoginContainerEmail" style="display:none">
        <input type="text" id="twoFactorLoginCodeEmail" autocomplete="one-time-code">
      </div>
      <div id="twoFactorLoginContainerEmailNoCookie" style="display:none">
        <div id="noCookieEmailContainer"><input type="text" id="twoFactorLoginCodeEmailNoCookie" autocomplete="one-time-code"></div>
        <div id="noCookieSmsContainer" style="display:none"><input type="text" id="twoFactorLoginCodePhone" autocomplete="one-time-code"></div>
      </div>
      <input type="checkbox" id="rememberMe" name="rememberMe">
    </fieldset>
  </form>
  <div id="accountLoginButtonContainer">
    <img id="accountLoginButton_loading" style="display:none">
    <button id="accountLoginButton" onclick="logInExec();" disabled>Login</button>
    <a href="/account/create">Create a New Account</a>
  </div>
</div>
<div id="modal_forceCcaptcha" style="display:none"></div>
<div id="bypassTwoFactor2FACodeContainer" style="display:none">
  <input id="bypassTwoFactor2FACode"><button type="button">Verify recovery</button>
</div>`;
