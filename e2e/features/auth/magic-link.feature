Feature: Magic-link sign-in (passwordless secondary option)

  Scenario: Sign in via emailed magic link
    Given a user exists with email "magic-happy@example.com" and password "TestPassword!123"
    And I am on the login page
    When I follow the "Sign in with link instead" link
    And I request a magic link for "magic-happy@example.com"
    Then I should see a "Check your email" confirmation
    When I open the magic link from the email to "magic-happy@example.com"
    Then I should be on the dashboard

  Scenario: Expired or invalid magic link shows an error
    Given I am not signed in
    When I open an invalid magic link
    Then I should see a magic-link expired error
