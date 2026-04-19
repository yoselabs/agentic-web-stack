Feature: Collaborators list shows owner and role badges

  Scenario: Owner sees themselves first with Owner badge and "(You)" suffix
    Given "alice" is signed up and signed in as "alice-visibility-owner" with email "alice-visibility-owner@example.com"
    And "bob" is signed up with username "bob-visibility-owner" and email "bob-visibility-owner@example.com"
    And "alice" has a list named "Visibility owner"
    And "bob" is a collaborator on "Visibility owner"
    When "alice" opens "Visibility owner"
    Then the collaborators list shows "alice-visibility-owner" with an "Owner" badge and "(You)" suffix for "alice"
    And the collaborators list shows "bob-visibility-owner" with a "Collaborator" badge for "alice"
    And no Remove button is shown on the owner row for "alice"

  Scenario: Collaborator sees owner and role badges but no Remove buttons
    Given "alice" is signed up and signed in as "alice-visibility-collab" with email "alice-visibility-collab@example.com"
    And "bob" is signed up with username "bob-visibility-collab" and email "bob-visibility-collab@example.com"
    And "alice" has a list named "Visibility collab"
    And "bob" is a collaborator on "Visibility collab"
    When "bob" opens "Visibility collab"
    Then the collaborators list shows "alice-visibility-collab" with an "Owner" badge for "bob"
    And the collaborators list shows "bob-visibility-collab" with a "Collaborator" badge and "(You)" suffix for "bob"
    And no Remove buttons are shown in the collaborators list for "bob"
