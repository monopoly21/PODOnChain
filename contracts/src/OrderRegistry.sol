// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EscrowPYUSD.sol";

contract OrderRegistry {
  enum Status {
    None,
    Created,
    Funded,
    Delivered,
    Disputed,
    Resolved
  }

  struct Order {
    address buyer;
    address supplier;
    uint256 amount;
    Status status;
  }

  address public immutable owner;
  address public immutable escrow;
  address public deliveryOracle;
  address public shipmentRegistry;

  mapping(uint256 => Order) public orders;

  event OrderCreated(uint256 indexed orderId, address indexed buyer, address indexed supplier, uint256 amount);
  event StatusUpdated(uint256 indexed orderId, Status status);
  event OracleUpdated(address indexed oracle);
  event ShipmentRegistryUpdated(address indexed shipmentRegistry);

  modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
  }

  modifier onlyOracle() {
    require(msg.sender == deliveryOracle, "not oracle");
    _;
  }

  modifier onlyShipmentRegistry() {
    require(msg.sender == shipmentRegistry, "not shipment registry");
    _;
  }

  constructor(address _escrow) {
    require(_escrow != address(0), "escrow required");
    owner = msg.sender;
    escrow = _escrow;
  }

  function setOracle(address oracle) external onlyOwner {
    require(oracle != address(0), "oracle required");
    deliveryOracle = oracle;
    emit OracleUpdated(oracle);
  }

  function setShipmentRegistry(address registry) external onlyOwner {
    require(registry != address(0), "registry required");
    shipmentRegistry = registry;
    emit ShipmentRegistryUpdated(registry);
  }

  function createOrder(uint256 orderId, address buyer, address supplier, uint256 amount) external {
    require(buyer != address(0) && supplier != address(0), "invalid parties");
    require(amount > 0, "amount = 0");
    Order storage order = orders[orderId];
    require(order.status == Status.None, "exists");

    orders[orderId] = Order({
      buyer: buyer,
      supplier: supplier,
      amount: amount,
      status: Status.Created
    });

    emit OrderCreated(orderId, buyer, supplier, amount);
    emit StatusUpdated(orderId, Status.Created);
  }

  function markFunded(uint256 orderId) external {
    Order storage order = orders[orderId];
    require(order.status == Status.Created, "not creatd");
    require(msg.sender == order.buyer, "only buyer");
    order.status = Status.Funded;
    emit StatusUpdated(orderId, Status.Funded);
  }

  function markDisputed(uint256 orderId) external {
    Order storage order = orders[orderId];
    require(order.status == Status.Funded || order.status == Status.Delivered, "bad status");
    require(msg.sender == order.buyer || msg.sender == order.supplier, "not party");
    order.status = Status.Disputed;
    emit StatusUpdated(orderId, Status.Disputed);
  }

  function resolveDispute(uint256 orderId, bool releaseToSupplier) external onlyOwner {
    Order storage order = orders[orderId];
    require(order.status == Status.Disputed, "not disputed");
    EscrowPYUSD paymaster = EscrowPYUSD(escrow);
    if (releaseToSupplier) {
      paymaster.release(orderId, order.supplier, order.amount);
      order.status = Status.Delivered;
    } else {
      paymaster.refund(orderId, order.buyer, order.amount);
      order.status = Status.Resolved;
    }
    emit StatusUpdated(orderId, order.status);
  }

  function releaseEscrow(uint256 orderId) external onlyOracle {
    Order storage order = orders[orderId];
    require(order.status == Status.Funded, "not funded");
    EscrowPYUSD(escrow).release(orderId, order.supplier, order.amount);
    order.status = Status.Delivered;
    emit StatusUpdated(orderId, Status.Delivered);
  }

  function releaseEscrowFromShipment(uint256 orderId, address courier, uint256 courierReward) external onlyShipmentRegistry {
    Order storage order = orders[orderId];
    require(order.status == Status.Funded, "not funded");
    EscrowPYUSD paymaster = EscrowPYUSD(escrow);
    uint256 amount = order.amount;
    if (courierReward > 0) {
      require(amount >= courierReward, "reward exceeds escrow");
      paymaster.release(orderId, courier, courierReward);
      amount -= courierReward;
    }
    if (amount > 0) {
      paymaster.release(orderId, order.supplier, amount);
    }
    order.amount = 0;
    order.status = Status.Delivered;
    emit StatusUpdated(orderId, Status.Delivered);
  }
}
