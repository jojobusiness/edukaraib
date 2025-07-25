exports.getUsers = (req, res) => {
  res.json([{ id: 1, name: "John Doe" }]);
};

exports.createUser = (req, res) => {
  const user = req.body;
  res.status(201).json({ message: "Utilisateur créé", user });
};
