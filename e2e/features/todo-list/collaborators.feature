Feature: Todo list collaborators

  Scenario: Invite email lands in Mailpit and Bob gains access
    Given "alice" is signed up and signed in as "alice-invite" with email "alice-invite@example.com"
    And "bob" is signed up with username "bob-invite" and email "bob-invite@example.com"
    And "alice" has a list named "Shared shopping invite"
    When "alice" invites "bob" to "Shared shopping invite"
    Then "bob" receives an email with subject containing "Shared shopping invite"
    When "bob" signs in and opens the invite link
    Then "bob" sees "Shared shopping invite" in their sidebar

  Scenario: Authorization cascade on removal (realtime revoke)
    Given "alice" is signed up and signed in as "alice-revoke" with email "alice-revoke@example.com"
    And "bob" is signed up with username "bob-revoke" and email "bob-revoke@example.com"
    And "alice" has a list named "Shared revoke"
    And "bob" is a collaborator on "Shared revoke"
    And "bob" has "Shared revoke" open in a browser
    When "alice" removes "bob" from "Shared revoke"
    Then "bob" sees "You no longer have access to this list" within 15 seconds
    And reloading "Shared revoke" as "bob" shows the access-lost state
