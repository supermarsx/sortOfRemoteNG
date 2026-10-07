/* Private Smart Router 3 adapter, based on user-supplied login DOM. */
function vodafoneRouterSelectors(ov) {
  return !!(
    ov &&
    ov.username ===
      '#mainbody #logindiv input#username[type="text"]:enabled:not([readonly])' &&
    ov.password ===
      '#mainbody #logindiv input#userpwd[type="password"]:enabled:not([readonly])' &&
    ov.submit ===
      '#mainbody #logindiv input#loginbtn[type="button"][name="login"]:enabled'
  );
}

function vodafoneRouterTarget(root, ov) {
  if (root !== document || !vodafoneRouterSelectors(ov)) return null;
  // SubmitForm resolves these IDs itself; duplicate IDs outside our container
  // would let discovery and the site's handler operate on different controls.
  if (
    ["mainbody", "logindiv", "username", "userpwd", "loginbtn"].some(
      function (id) {
        return root.querySelectorAll("#" + id).length !== 1;
      },
    )
  )
    return null;
  var containers = root.querySelectorAll("#mainbody #logindiv");
  var users = root.querySelectorAll(ov.username);
  var passwords = root.querySelectorAll(ov.password);
  var buttons = root.querySelectorAll(ov.submit);
  if (
    containers.length !== 1 ||
    users.length !== 1 ||
    passwords.length !== 1 ||
    buttons.length !== 1
  )
    return null;
  var user = users[0],
    pw = passwords[0],
    button = buttons[0];
  var view = root.defaultView;
  if (
    ![user, pw, button].every(function (element) {
      return (
        containers[0].contains(element) &&
        isVisible(element) &&
        !element.form &&
        !element.hasAttribute("form") &&
        !element.closest('[inert], [aria-busy="true"], [aria-disabled="true"]')
      );
    }) ||
    ["formaction", "formmethod", "formtarget"].some(function (name) {
      return button.hasAttribute(name);
    }) ||
    !/^\s*SubmitForm\(\);?\s*$/.test(button.getAttribute("onclick") || "") ||
    typeof button.onclick !== "function" ||
    typeof view.SubmitForm !== "function"
  )
    return null;
  var error = containers[0].querySelector("#DivErrPage");
  if (error && error.textContent.trim() && isVisible(error)) return null;
  return {
    user: user,
    pw: pw,
    form: null,
    submit: button,
    vodafoneRouter: { click: button.onclick, login: view.SubmitForm },
  };
}

function sameVodafoneRouterHandler(previous, current) {
  return (
    !previous.vodafoneRouter ||
    !!(
      current &&
      current.vodafoneRouter &&
      previous.vodafoneRouter.click === current.vodafoneRouter.click &&
      previous.vodafoneRouter.login === current.vodafoneRouter.login
    )
  );
}
