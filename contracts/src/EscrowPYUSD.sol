// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
  function transferFrom(address from, address to, uint256 value) external returns (bool);
  function transfer(address to, uint256 value) external returns (bool);
}

contract EscrowPYUSD {
  address public immutable token;
  address public orderRegistry;

  mapping(uint256 => uint256) public escrowed;

  event EscrowFunded(uint256 indexed orderId, address indexed payer, uint256 amount);
  event EscrowReleased(uint256 indexed orderId, address indexed payee, uint256 amount);
  event EscrowRefunded(uint256 indexed orderId, address indexed payee, uint256 amount);

  modifier onlyOrderRegistry() {
    require(msg.sender == orderRegistry, "not order registry");
    _;
  }

  constructor(address _token) {
    require(_token != address(0), "token required");
    token = _token;
  }

  function setOrderRegistry(address _orderRegistry) external {
    require(orderRegistry == address(0), "already set");
    require(_orderRegistry != address(0), "invalid");
    orderRegistry = _orderRegistry;
  }

  function fund(uint256 orderId, uint256 amount) external {
    require(orderRegistry != address(0), "registry not set");
    require(amount > 0, "amount = 0");
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    escrowed[orderId] += amount;
    emit EscrowFunded(orderId, msg.sender, amount);
  }

  function release(uint256 orderId, address supplier, uint256 amount) external onlyOrderRegistry {
    require(amount > 0, "amount = 0");
    uint256 balance = escrowed[orderId];
    require(balance >= amount, "insufficient");
    escrowed[orderId] = balance - amount;
    require(IERC20(token).transfer(supplier, amount), "transfer failed");
    emit EscrowReleased(orderId, supplier, amount);
  }

  function refund(uint256 orderId, address buyer, uint256 amount) external onlyOrderRegistry {
    require(amount > 0, "amount = 0");
    uint256 balance = escrowed[orderId];
    require(balance >= amount, "insufficient");
    escrowed[orderId] = balance - amount;
    require(IERC20(token).transfer(buyer, amount), "refund failed");
    emit EscrowRefunded(orderId, buyer, amount);
  }
}
