Feature: Todo Lists

  Scenario: Empty state shows no lists
    Given I am signed in as "empty-lists@example.com"
    And I am on the todo lists page
    Then I should see "No lists yet"

  Scenario: Create a todo list
    Given I am signed in as "create-list@example.com"
    And I am on the todo lists page
    When I create a list named "Groceries"
    Then I should see "Groceries"

  Scenario: Add a todo to a list
    Given I am signed in as "list-todo@example.com"
    And I am on the todo lists page
    And I have a list named "Work"
    And I am in the list "Work"
    When I fill in "Add a todo..." with "Finish report"
    And I click "Add"
    Then I should see "Finish report"

  Scenario: Delete a todo list
    Given I am signed in as "delete-list@example.com"
    And I am on the todo lists page
    And I have a list named "Old list"
    When I delete the list "Old list"
    Then I should not see "Old list"
    And I should see "No lists yet"

  Scenario: Lists are private to each user
    Given I am signed in as "private-list@example.com"
    And I am on the todo lists page
    And I have a list named "My private list"
    When I sign out and sign in as "other-list-user@example.com"
    And I am on the todo lists page
    Then I should not see "My private list"
    And I should see "No lists yet"
