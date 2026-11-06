export default [
  {
    "id": "niro-instagram-post",
    "name": "Niro \u00b7 Instagram post",
    "nodes": [
      {
        "id": "start",
        "type": "trigger.manual",
        "x": 80,
        "y": 200,
        "params": {
          "payload": "{\n  \"cafe\": \"Brew Lab\",\n  \"city\": \"Mysuru\"\n}"
        }
      },
      {
        "id": "city",
        "type": "logic.if",
        "x": 380,
        "y": 200,
        "params": {
          "left": "{{ $in.city }}",
          "op": "equals",
          "right": "Mysuru"
        }
      },
      {
        "id": "copy",
        "type": "ai.claude",
        "x": 700,
        "y": 90,
        "params": {
          "role": "Copywriter",
          "system": "You are a concise marketing copywriter for Niro, a cafe loyalty app.",
          "prompt": "Write one Instagram caption for {{ $in.cafe }} in {{ $in.city }}. Mention the 1-month free trial.",
          "model": "claude-sonnet-5-5"
        }
      },
      {
        "id": "approve",
        "type": "approval.human",
        "x": 1020,
        "y": 90,
        "params": {
          "message": "Publish this caption?\n{{ $in.text }}"
        }
      },
      {
        "id": "done",
        "type": "log.output",
        "x": 1340,
        "y": 40,
        "params": {
          "message": "Approved: {{ $in.text }}"
        }
      },
      {
        "id": "skip",
        "type": "log.output",
        "x": 1340,
        "y": 250,
        "params": {
          "message": "Rejected, nothing published"
        }
      },
      {
        "id": "other",
        "type": "log.output",
        "x": 700,
        "y": 330,
        "params": {
          "message": "Outside Mysuru launch city, skipped"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "start",
        "to": "city"
      },
      {
        "id": "e2",
        "from": "city",
        "to": "copy",
        "port": "true"
      },
      {
        "id": "e3",
        "from": "city",
        "to": "other",
        "port": "false"
      },
      {
        "id": "e4",
        "from": "copy",
        "to": "approve"
      },
      {
        "id": "e5",
        "from": "approve",
        "to": "done",
        "port": "approved"
      },
      {
        "id": "e6",
        "from": "approve",
        "to": "skip",
        "port": "rejected"
      }
    ]
  },
  {
    "id": "niro-marketing-team",
    "name": "Niro \u00b7 Marketing team (5 agents)",
    "nodes": [
      {
        "id": "start",
        "type": "trigger.manual",
        "x": 60,
        "y": 120,
        "params": {
          "payload": "{\n  \"cafe\": \"Brew Lab\",\n  \"city\": \"Mysuru\"\n}"
        }
      },
      {
        "id": "team",
        "type": "ai.team",
        "x": 360,
        "y": 120,
        "params": {}
      },
      {
        "id": "approve",
        "type": "approval.human",
        "x": 660,
        "y": 120,
        "params": {
          "message": "Publish this plan?\n{{ $in.text }}"
        }
      },
      {
        "id": "send",
        "type": "notify.message",
        "x": 960,
        "y": 30,
        "params": {
          "connection": "",
          "text": "{{ $in.text }}"
        }
      },
      {
        "id": "rej",
        "type": "log.output",
        "x": 960,
        "y": 230,
        "params": {
          "message": "Rejected, nothing sent"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "start",
        "to": "team"
      },
      {
        "id": "e2",
        "from": "team",
        "to": "approve"
      },
      {
        "id": "e3",
        "from": "approve",
        "to": "send",
        "port": "approved"
      },
      {
        "id": "e4",
        "from": "approve",
        "to": "rej",
        "port": "rejected"
      }
    ]
  }
];
