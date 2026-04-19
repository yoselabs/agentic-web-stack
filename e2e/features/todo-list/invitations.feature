Feature: Invite collaborators by username with autocomplete and pending UI

  Scenario: Autocomplete shows matching users by username prefix
    Given "alice" is signed up and signed in as "alice-autocomplete" with email "alice-autocomplete@example.com"
    And "alicia" is signed up with username "alicia-autocomplete" and email "alicia-autocomplete@example.com"
    And "bob" is signed up with username "bob-autocomplete" and email "bob-autocomplete@example.com"
    And "alice" has a list named "Groceries autocomplete"
    When "alice" opens the share dialog for "Groceries autocomplete"
    And "alice" types "alicia-auto" in the invite field
    Then "alice" sees "@alicia-autocomplete" in the invite suggestions
    And "alice" does not see "@bob-autocomplete" in the invite suggestions

  Scenario: Unknown username shows an inline no-match error
    Given "alice" is signed up and signed in as "alice-nomatch" with email "alice-nomatch@example.com"
    And "alice" has a list named "Groceries nomatch"
    When "alice" opens the share dialog for "Groceries nomatch"
    And "alice" types "nobody-exists-xyz" in the invite field
    Then "alice" sees "No user with that username."

  Scenario: Invited user sees the pending invite on their dashboard
    Given "alice" is signed up and signed in as "alice-pending-invitee" with email "alice-pending-invitee@example.com"
    And "bob" is signed up with username "bob-pending-invitee" and email "bob-pending-invitee@example.com"
    And "alice" has a list named "Groceries pending invitee"
    And "alice" has invited "bob" to "Groceries pending invitee"
    When "bob" signs in and opens the dashboard
    Then "bob" sees "Groceries pending invitee" under pending invitations
    And "bob" can Accept or Decline the invite

  Scenario: Owner can revoke a pending invite from the share dialog
    Given "alice" is signed up and signed in as "alice-revoke-invite" with email "alice-revoke-invite@example.com"
    And "bob" is signed up with username "bob-revoke-invite" and email "bob-revoke-invite@example.com"
    And "alice" has a list named "Groceries revoke invite"
    And "alice" has invited "bob" to "Groceries revoke invite"
    When "alice" opens the share dialog for "Groceries revoke invite"
    Then "alice" sees "bob-revoke-invite" in the pending invites section
    When "alice" revokes the invite for "bob-revoke-invite"
    Then "alice" does not see "bob-revoke-invite" in the pending invites section
