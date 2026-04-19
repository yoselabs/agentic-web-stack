Feature: Authentication

  Scenario: Sign up with email and password
    Given I am on the login page
    When I sign up as "Test User" with email "signup@example.com"
    Then I should be on the dashboard
    And I should see "Test User"

  Scenario: Sign in with existing account
    Given a user exists with email "signin@example.com" and password "TestPassword!123"
    And I am on the login page
    When I sign in with email "signin@example.com" and password "TestPassword!123"
    Then I should be on the dashboard

  Scenario: Sign in with wrong password
    Given a user exists with email "wrongpw@example.com" and password "TestPassword!123"
    And I am on the login page
    When I sign in with email "wrongpw@example.com" and password "wrongpassword"
    Then I should see an error message

  Scenario: Protected route redirects to login
    Given I am not signed in
    When I navigate to "/dashboard"
    Then I should be on the login page

  Scenario: Sign out
    Given I am signed in as "signout@example.com"
    And I am on the dashboard
    When I click "Sign Out"
    Then I should be signed out
