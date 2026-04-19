Feature: Sign-in form validates on blur and submit, not on every keystroke

  Scenario: Typing in the email field does not flag the password field
    Given I am on the login page
    When I type "foo@example.com" in the email field
    Then the password field shows no error

  Scenario: Blurring an empty email shows an email error
    Given I am on the login page
    When I focus then blur the email field leaving it empty
    Then I should see an email error

  Scenario: Signin password placeholder differs from signup password placeholder
    Given I am on the login page
    Then the password placeholder is "Your password"
    When I toggle to the sign-up mode
    Then the password placeholder contains "Min 8 characters"
