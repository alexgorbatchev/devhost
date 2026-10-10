// Package skill carries the instructions printed by the skill command.
package skill

const document = `Install the devhost skill using the Skills CLI:

  npx skills add alexgorbatchev/devhost

Skill:

  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost
`

// Document returns the skill instructions and repository URL.
func Document() string {
	return document
}
