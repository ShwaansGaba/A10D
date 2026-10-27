import 'dart:convert';

class RegisteredUser {
  final String id;
  final String name;
  final String photoPath;
  final DateTime registeredAt;
  final List<List<double>> embeddings;

  RegisteredUser({
    required this.id,
    required this.name,
    required this.photoPath,
    required this.registeredAt,
    required this.embeddings,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'photoPath': photoPath,
      'registeredAt': registeredAt.toIso8601String(),
      'embeddings': embeddings,
    };
  }

  factory RegisteredUser.fromMap(Map<String, dynamic> map) {
    List<List<double>> parsedEmbeddings = [];

    if (map['embeddings'] != null) {
      final list = map['embeddings'] as List<dynamic>;
      for (final item in list) {
        if (item is List) {
          parsedEmbeddings.add(item.map((e) => (e as num).toDouble()).toList());
        }
      }
    } else if (map['embedding'] != null) {
      // Backward compatibility for single embedding
      parsedEmbeddings.add(
        (map['embedding'] as List<dynamic>)
            .map((e) => (e as num).toDouble())
            .toList(),
      );
    }

    return RegisteredUser(
      id: map['id'] as String,
      name: map['name'] as String,
      photoPath: map['photoPath'] as String,
      registeredAt: DateTime.parse(map['registeredAt'] as String),
      embeddings: parsedEmbeddings,
    );
  }

  String toJson() => json.encode(toMap());

  factory RegisteredUser.fromJson(String source) =>
      RegisteredUser.fromMap(json.decode(source) as Map<String, dynamic>);
}
