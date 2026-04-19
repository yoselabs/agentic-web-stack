Feature: Homepage is public, navigation reflects auth state

  Scenario: Anonymous visitor sees the hero and a Sign In button
    Given I am not signed in
    When I navigate to "/"
    Then I should see the "Agentic Web Stack" hero heading
    And I should see a "Sign In" button in the navigation

  Scenario: Signed-in user sees their account menu and no Sign In button
    Given I am signed in as "homepage-authed@example.com"
    When I navigate to "/"
    Then I should see a "Dashboard" link in the navigation
    And I should not see a "Sign In" button in the navigation

  Scenario: Admin user sees the Jobs Admin link in the navigation
    Given I am signed in as "homepage-admin@example.com"
    And I promote "homepage-admin@example.com" to admin
    When I navigate to "/"
    Then I should see a "Jobs Admin" link in the navigation
