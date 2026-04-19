@mobile
Feature: Mobile Navigation

  Scenario: Hamburger menu shows navigation links
    Given I am signed in as "mobile-nav@example.com"
    And I am on the dashboard
    When I open the mobile menu
    Then I should see "Dashboard" in the menu
    And I should see "Todo Lists" in the menu

  Scenario: Mobile menu navigates and closes
    Given I am signed in as "mobile-menu-nav@example.com"
    And I am on the dashboard
    When I open the mobile menu
    And I tap "Todo Lists" in the menu
    Then I should be on the todo lists page
    And the mobile menu should be closed
